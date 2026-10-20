import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ChunkModel, ConversationModel, DocumentModel, WorkspaceModel } from '@support-agent/db';
import { CHAT_MESSAGES_PER_MINUTE } from '../src/routes/chat';
import { fakeEmbed } from './fakes';
import { app, fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

type Agent = Awaited<ReturnType<typeof signedUpBrowser>>;
type SseEvent = { event: string; data: Record<string, unknown> };

/** Parses a Server-Sent Events body into its events. */
function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}');
      return { event, data };
    });
}

async function ask(agent: Agent, message: string, conversationId?: string) {
  const res = await agent.post('/chat').send({ message, conversationId }).buffer(true).parse((r, cb) => {
    let text = '';
    r.on('data', (c: Buffer) => (text += c.toString()));
    r.on('end', () => cb(null, text));
  });
  return { status: res.status, type: res.headers['content-type'] as string, events: parseSse(String(res.body)), body: res.body };
}

const answerText = (events: SseEvent[]) => events.filter((e) => e.event === 'token').map((e) => e.data.text).join('');

async function addDoc(workspaceName: string, filename: string, texts: string[]) {
  const ws = await WorkspaceModel.findOne({ name: workspaceName });
  const doc = await DocumentModel.create({ workspaceId: ws!._id, filename, contentType: 'text/plain', size: 1, s3Key: `k/${filename}`, status: 'ready' });
  await ChunkModel.insertMany(texts.map((text, position) => ({ workspaceId: ws!._id, documentId: doc._id, position, text, embedding: fakeEmbed(text) })));
}

describe('chat', () => {
  it('requires login and a message', async () => {
    await request(app).post('/chat').send({ message: 'hi' }).expect(401);
    const agent = await signedUpBrowser();
    await agent.post('/chat').send({ message: '  ' }).expect(400);
  });

  it('streams an answer built from my documents, with sources, and saves the conversation', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'shipping.md', ['Standard shipping takes 3 to 5 business days.', 'Gift cards never expire.']);

    const { status, type, events } = await ask(agent, 'how long does standard shipping take');
    expect(status).toBe(200);
    expect(type).toMatch(/text\/event-stream/);
    expect(events.map((e) => e.event)).toEqual(['meta', 'token', 'token', 'done']);

    const meta = events[0]!.data as { conversationId: string; sources: { filename: string; n: number }[] };
    expect(meta.sources[0]).toMatchObject({ n: 1, filename: 'shipping.md' });
    expect(answerText(events)).toBe('Standard shipping takes 3 to 5 days [1].');
    expect(events.at(-1)!.data).toMatchObject({ firstTokenMs: expect.any(Number), totalMs: expect.any(Number) });

    // The model saw the rules, the workspace name, and the numbered passage.
    const prompt = fakes.generated[0]!;
    expect(prompt.system).toContain('Acme');
    expect(prompt.turns.at(-1)).toMatchObject({ text: expect.stringContaining('[1] (from shipping.md)\nStandard shipping takes 3 to 5 business days.') });

    const saved = await ConversationModel.findById(meta.conversationId).lean();
    expect(saved!.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'how long does standard shipping take'],
      ['assistant', 'Standard shipping takes 3 to 5 days [1].'],
    ]);
    expect(saved!.messages[1]!.sources![0]).toMatchObject({ filename: 'shipping.md' });
    // Recorded for analytics at write time, and the answer's id is sent for 👍/👎.
    expect(saved!.messages[1]).toMatchObject({ question: 'how long does standard shipping take', questionKey: 'how long does standard shipping take', unanswered: false });
    expect(events.at(-1)!.data.messageId).toBe(String(saved!.messages[1]!._id));
  });

  it('tells the model when nothing relevant was found, so it can say it doesn\'t know or use a tool', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'shipping.md', ['Standard shipping takes 3 to 5 business days.']);

    const { events } = await ask(agent, 'who is your chief executive officer');
    expect((events[0]!.data as { sources: unknown[] }).sources).toEqual([]);
    const saved = await ConversationModel.findById((events[0]!.data as { conversationId: string }).conversationId).lean();
    expect(saved!.messages[1]).toMatchObject({ unanswered: true, questionKey: 'who is your chief executive officer' });
    expect(fakes.generated[0]!.turns.at(-1)).toMatchObject({ text: expect.stringContaining('(no relevant passages found)') });
    expect(fakes.generated[0]!.tools?.map((t) => t.name)).toEqual([
      'get_order_status',
      'create_ticket',
      'request_callback',
      'handoff_to_human',
      'flag_unanswered',
    ]);
  });

  it('continues a conversation with history, and keeps the topic for follow-ups', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'shipping.md', ['Standard shipping takes 3 to 5 business days. Express shipping arrives next day.']);

    const first = await ask(agent, 'how long does standard shipping take');
    const conversationId = (first.events[0]!.data as { conversationId: string }).conversationId;
    const second = await ask(agent, 'and express?', conversationId);

    expect((second.events[0]!.data as { conversationId: string }).conversationId).toBe(conversationId);
    const turns = fakes.generated[1]!.turns;
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect(turns[0]).toMatchObject({ text: 'how long does standard shipping take' });
    expect((await ConversationModel.findById(conversationId).lean())!.messages).toHaveLength(4);
  });

  it("can't read or continue another workspace's conversation, or use its documents", async () => {
    const alice = await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    await addDoc('A Corp', 'alice.md', ['Alice secret discount code is SAVE50.']);

    const aliceChat = await ask(alice, 'alice secret discount code');
    const conversationId = (aliceChat.events[0]!.data as { conversationId: string }).conversationId;

    expect((await ask(bob, 'hello', conversationId)).status).toBe(404);
    await ask(bob, 'alice secret discount code');
    // Bob's prompt never contains Alice's passage.
    expect(JSON.stringify(fakes.generated.at(-1)!.turns)).not.toContain('SAVE50');
  });

  it(`limits each workspace to ${CHAT_MESSAGES_PER_MINUTE} messages a minute`, async () => {
    const agent = await signedUpBrowser();
    for (let i = 0; i < CHAT_MESSAGES_PER_MINUTE; i++) expect((await ask(agent, `question ${i}`)).status).toBe(200);
    const blocked = await agent.post('/chat').send({ message: 'one more' }).expect(429);
    expect(blocked.headers['retry-after']).toBe('42');
    expect(blocked.body.error).toBe('rate_limited');
  });

  it('turns a model failure mid-answer into an error event, without leaking details', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'shipping.md', ['Standard shipping takes 3 to 5 business days.']);
    fakes.model.fail = true;

    const { events } = await ask(agent, 'how long does standard shipping take');
    expect(events.map((e) => e.event)).toEqual(['meta', 'token', 'error']);
    expect(JSON.stringify(events)).not.toContain('exploded');
  });

  it('tells the customer to try again in a minute when the model provider is busy', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'shipping.md', ['Standard shipping takes 3 to 5 business days.']);
    fakes.model.busy = true;

    const { events } = await ask(agent, 'how long does standard shipping take');
    expect(events.at(-1)).toEqual({ event: 'error', data: { message: 'The assistant is very busy right now. Please try again in a minute.' } });
  });
});

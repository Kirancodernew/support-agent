import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConversationModel, newObjectId, WorkspaceModel } from '@support-agent/db';
import { INSIGHTS_TIMEZONE } from '../src/routes/insights';
import { app, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const istDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: INSIGHTS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

type Msg = { role: 'user' | 'assistant'; content?: string; at: Date; sources?: string[]; unanswered?: boolean; question?: string; questionKey?: string; feedback?: 'up' | 'down'; firstTokenMs?: number; actions?: { tool: string; ok: boolean }[] };

/** Inserts a conversation exactly as given (raw insert, so our timestamps are kept). */
async function convo(workspaceName: string, messages: Msg[], extra: Record<string, unknown> = {}) {
  const ws = await WorkspaceModel.findOne({ name: workspaceName });
  const updatedAt = messages.reduce((max, m) => (m.at > max ? m.at : max), new Date(0));
  const doc = {
    _id: newObjectId(),
    workspaceId: ws!._id,
    title: messages[0]?.content ?? 'x',
    channel: 'dashboard',
    needsHuman: false,
    createdAt: messages[0]?.at ?? new Date(),
    updatedAt,
    ...extra,
    messages: messages.map(({ at, sources, ...m }) => ({
      _id: newObjectId(),
      content: m.content ?? 'answer',
      ...m,
      sources: sources?.map((filename, position) => ({ documentId: newObjectId(), filename, position, score: 0.9 })),
      createdAt: at,
    })),
  };
  await ConversationModel.collection.insertOne(doc);
  return doc;
}

const q = (content: string, at: Date): Msg => ({ role: 'user', content, at });
const a = (at: Date, extra: Partial<Msg> = {}): Msg => ({ role: 'assistant', at, firstTokenMs: 1000, ...extra });

describe('insights summary', () => {
  it('requires login and a supported range', async () => {
    await request(app).get('/insights/summary').expect(401);
    const agent = await signedUpBrowser();
    await agent.get('/insights/summary?days=5').expect(400);
  });

  it('computes every card from the period, ignoring other workspaces and older chats', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await signedUpBrowser('other@b.test', 'Other');
    const t = ago(DAY);
    await convo('Acme', [
      q('shipping?', t),
      a(t, { content: 'Ships in 3 days [1].', sources: ['shipping.md'], feedback: 'up', firstTokenMs: 800 }),
      q('refunds?', t),
      a(t, { content: 'Refunds in 5 days [1], shipping is free [2].', sources: ['returns.md', 'shipping.md'], feedback: 'up', firstTokenMs: 1200 }),
    ]);
    // Retrieved a passage but couldn't answer: neither "from docs" nor a cited document.
    await convo('Acme', [q('ceo?', t), a(t, { sources: ['about.md'], unanswered: true, feedback: 'down', firstTokenMs: 3000 })], { channel: 'widget' });
    await convo('Acme', [q('order 1001', t), a(t, { actions: [{ tool: 'get_order_status', ok: true }], firstTokenMs: 2000 })]);
    await convo('Acme', [q('old question', ago(10 * DAY)), a(ago(10 * DAY), { sources: ['old.md'] })]); // outside 7 days
    await convo('Other', [q('not mine', t), a(t, { sources: ['secret.md'] })]); // another workspace

    const { body } = await agent.get('/insights/summary?days=7').expect(200);
    expect(body).toMatchObject({
      days: 7,
      conversations: 3,
      questions: 4,
      answers: 4,
      answeredFromDocsPct: 50, // 2 of 4 cited a passage
      unansweredPct: 25, // 1 of 4 flagged
      satisfaction: { up: 2, down: 1, pct: 67 },
      topDocuments: [
        { filename: 'shipping.md', citations: 2 },
        { filename: 'returns.md', citations: 1 },
      ],
      actions: { get_order_status: 1 },
    });
    expect(body.latencyMs.p50).toBeGreaterThanOrEqual(1000);
    expect(body.latencyMs.p95).toBe(3000);
    expect(body.daily).toHaveLength(7);
    expect(body.daily.find((d: { day: string }) => d.day === istDay(t))).toMatchObject({ dashboard: 3, widget: 1 });
  });

  it('compares with the previous period', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await convo('Acme', [q('this week', ago(DAY)), a(ago(DAY))]);
    await convo('Acme', [q('this week too', ago(DAY)), a(ago(DAY))]);
    await convo('Acme', [q('last week', ago(9 * DAY)), a(ago(9 * DAY))]);
    const { body } = await agent.get('/insights/summary?days=7').expect(200);
    expect(body.change).toEqual({ conversations: 100, questions: 100 }); // 1 → 2
  });

  it('counts days in Indian time: 10:30pm IST stays on that day', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    // 17:00 UTC two days ago = 22:30 IST the same day; 19:00 UTC = 00:30 IST the *next* day.
    const base = new Date(Date.now() - 2 * DAY);
    const evening = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 17, 0));
    const pastMidnightIst = new Date(evening.getTime() + 2 * 60 * 60 * 1000);
    await convo('Acme', [q('late evening', evening), a(evening), q('after midnight IST', pastMidnightIst), a(pastMidnightIst)]);

    const { body } = await agent.get('/insights/summary?days=7').expect(200);
    const count = (d: Date) => body.daily.find((x: { day: string }) => x.day === istDay(d))?.dashboard;
    expect(istDay(evening)).not.toBe(istDay(pastMidnightIst));
    expect(count(evening)).toBe(1);
    expect(count(pastMidnightIst)).toBe(1);
  });
});

describe('unanswered questions', () => {
  it('groups the same question however it was typed, most asked first', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const t = ago(DAY);
    const miss = (question: string, at = t) =>
      convo('Acme', [q(question, at), a(at, { unanswered: true, question, questionKey: question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim() })]);
    await miss('Do you ship to Dubai?');
    await miss('do you ship to dubai');
    await miss('DO YOU SHIP TO DUBAI!!', ago(DAY / 2));
    await miss('Student discount?');
    await miss('Gift wrapping?', ago(20 * DAY));

    const week = (await agent.get('/insights/unanswered?days=7').expect(200)).body.questions;
    expect(week.map((x: { question: string; count: number }) => [x.question, x.count])).toEqual([
      ['DO YOU SHIP TO DUBAI!!', 3], // shown with the latest wording
      ['Student discount?', 1],
    ]);
    const month = (await agent.get('/insights/unanswered?days=30').expect(200)).body.questions;
    expect(month).toHaveLength(3);
  });
});

describe('conversations', () => {
  it('pages with a cursor: no gaps or repeats, even when new chats arrive', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    for (let i = 0; i < 25; i++) await convo('Acme', [q(`question ${i}`, ago((i + 1) * 60_000))]);

    const first = (await agent.get('/conversations').expect(200)).body;
    expect(first.items).toHaveLength(20);
    expect(first.items[0].title).toBe('question 0'); // newest first
    await convo('Acme', [q('brand new', new Date())]); // arrives between page loads

    const second = (await agent.get(`/conversations?cursor=${first.nextCursor}`).expect(200)).body;
    expect(second.items.map((c: { title: string }) => c.title)).toEqual(['question 20', 'question 21', 'question 22', 'question 23', 'question 24']);
    expect(second.nextCursor).toBeNull();
  });

  it('filters to chats needing a human or with a 👎, and shows the transcript', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const t = ago(DAY);
    await convo('Acme', [q('fine', t), a(t)]);
    await convo('Acme', [q('get me a person', t), a(t)], { needsHuman: true });
    const bad = await convo('Acme', [q('wrong answer', t), a(t, { content: 'nonsense', feedback: 'down' })]);

    expect((await agent.get('/conversations?filter=needs_human')).body.items.map((c: { title: string }) => c.title)).toEqual(['get me a person']);
    const disliked = (await agent.get('/conversations?filter=disliked')).body.items;
    expect(disliked).toMatchObject([{ title: 'wrong answer', disliked: true }]);

    const detail = (await agent.get(`/conversations/${String(bad._id)}`).expect(200)).body;
    expect(detail.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', 'wrong answer'],
      ['assistant', 'nonsense'],
    ]);
  });

  it("never lists or opens another workspace's conversations", async () => {
    await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    const alices = await convo('A Corp', [q('private', ago(DAY))]);
    expect((await bob.get('/conversations')).body.items).toHaveLength(0);
    await bob.get(`/conversations/${String(alices._id)}`).expect(404);
  });
});

describe('feedback', () => {
  it('lets the owner rate an answer, change it, and clear it — only on assistant messages', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const c = await convo('Acme', [q('hi', ago(DAY)), a(ago(DAY))]);
    const [userMsg, answer] = c.messages;
    const rate = (messageId: unknown, value: string | null) => agent.post(`/conversations/${String(c._id)}/feedback`).send({ messageId: String(messageId), value });

    await rate(answer!._id, 'down').expect(204);
    await rate(answer!._id, 'up').expect(204);
    const rated = (await ConversationModel.findById(c._id).lean())!;
    expect(rated.messages[1]!.feedback).toBe('up');
    expect(rated.updatedAt).toEqual(c.updatedAt); // rating doesn't count as activity
    await rate(answer!._id, null).expect(204);
    expect((await ConversationModel.findById(c._id).lean())!.messages[1]!.feedback).toBeNull();
    await rate(userMsg!._id, 'up').expect(404);
  });

  it("lets a widget visitor rate only their own conversation's answers", async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const { body: settings } = await agent.put('/widget-settings').send({ allowedOrigins: ['https://acme.example'] });
    const c = await convo('Acme', [q('hi', ago(DAY)), a(ago(DAY))], { channel: 'widget', visitorId: 'visitor-aaaa-1111' });
    const send = (visitorId: string) =>
      request(app).post('/public/feedback').send({
        key: settings.publishableKey,
        visitorId,
        conversationId: String(c._id),
        messageId: String(c.messages[1]!._id),
        value: 'up',
      });
    await send('visitor-bbbb-2222').expect(404);
    await send('visitor-aaaa-1111').expect(204);
  });
});

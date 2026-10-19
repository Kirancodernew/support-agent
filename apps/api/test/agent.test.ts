import { describe, expect, it } from 'vitest';
import { ConversationModel, InboxItemModel, WorkspaceModel } from '@support-agent/db';
import type { GenerateEvent } from '@support-agent/llm';
import { MAX_AGENT_STEPS } from '../src/chat/answer';
import { GIVE_UP_ANSWER } from '../src/chat/prompt';
import { fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

type Agent = Awaited<ReturnType<typeof signedUpBrowser>>;
type SseEvent = { event: string; data: Record<string, unknown> };

const parseSse = (body: string): SseEvent[] =>
  body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => ({ event: /^event: (.*)$/m.exec(b)?.[1] ?? '', data: JSON.parse(/^data: (.*)$/m.exec(b)?.[1] ?? '{}') }));

async function ask(agent: Agent, message: string, conversationId?: string) {
  const res = await agent.post('/chat').send({ message, conversationId }).buffer(true).parse((r, cb) => {
    let text = '';
    r.on('data', (c: Buffer) => (text += c.toString()));
    r.on('end', () => cb(null, text));
  });
  const events = parseSse(String(res.body));
  return {
    events,
    text: events.filter((e) => e.event === 'token').map((e) => e.data.text).join(''),
    tools: events.filter((e) => e.event === 'tool').map((e) => `${e.data.name}:${e.data.status}`),
    conversationId: (events[0]?.data as { conversationId?: string }).conversationId,
  };
}

const call = (name: string, args: Record<string, unknown>): GenerateEvent[] => [{ type: 'toolCall', call: { id: `c-${name}`, name, args } }];
const say = (text: string): GenerateEvent[] => [{ type: 'text', text }];
const toolResults = (i: number) => {
  const last = fakes.generated[i]!.turns.at(-1)!;
  return last.role === 'tool' ? last.results : [];
};

async function connectShop(workspaceName = 'Acme') {
  await WorkspaceModel.updateOne({ name: workspaceName }, { orderWebhookUrl: 'https://shop.example/orders', webhookSecret: 'whsec_test' });
}

const TICKET = { summary: 'Order 1001 arrived damaged', details: 'The mug was cracked', email: 'demo@acme.example' };

describe('agent tools', () => {
  it('looks up an order and answers from the result', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await connectShop();
    fakes.model.script.push(call('get_order_status', { orderId: '1001', email: 'Demo@Acme.example' }), say('Your order has shipped and arrives 21 Oct.'));

    const res = await ask(agent, 'where is my order 1001? demo@acme.example');
    expect(res.tools).toEqual(['get_order_status:running', 'get_order_status:done']);
    expect(res.text).toBe('Your order has shipped and arrives 21 Oct.');
    // Arguments are validated and normalised before the business's system is called.
    expect(fakes.orderCalls).toEqual([{ url: 'https://shop.example/orders', query: { orderId: '1001', email: 'demo@acme.example' } }]);
    // The tool result went back to the model, along with the model's own raw reply.
    expect(toolResults(1)[0]).toMatchObject({ name: 'get_order_status', result: { found: true } });
    expect(fakes.generated[1]!.turns.at(-2)).toMatchObject({ role: 'assistant', providerParts: ['raw-reply'] });

    const saved = await ConversationModel.findById(res.conversationId).lean();
    expect(saved!.messages.at(-1)!.actions).toEqual([{ tool: 'get_order_status', ok: true }]);
  });

  it("doesn't reveal whether an order number exists when the email doesn't match", async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await connectShop();
    fakes.orderResult.next = { found: false };
    fakes.model.script.push(call('get_order_status', { orderId: '1003', email: 'someone@else.example' }), say('No match.'));
    await ask(agent, 'order 1003 for someone@else.example');
    expect(toolResults(1)[0]!.result).toEqual({ found: false, note: 'No order matches that number and email.' });
  });

  it('rejects bad arguments without calling the order system', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await connectShop();
    fakes.model.script.push(call('get_order_status', { orderId: '1001' }), say('What is your email?'));
    const res = await ask(agent, 'where is order 1001');
    expect(res.tools).toEqual(['get_order_status:running', 'get_order_status:failed']);
    expect(fakes.orderCalls).toHaveLength(0);
    expect(JSON.stringify(toolResults(1)[0]!.result)).toContain('Invalid arguments');
  });

  it('says order lookup is not set up when the business has no webhook', async () => {
    const agent = await signedUpBrowser();
    fakes.model.script.push(call('get_order_status', { orderId: '1001', email: 'a@b.example' }), say('ok'));
    await ask(agent, 'order 1001 a@b.example');
    expect(JSON.stringify(toolResults(1)[0]!.result)).toContain('not set up');
  });

  it('only creates a ticket after the customer confirms, enforced by the server', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');

    // Turn 1: the model tries to create it straight away, then tries again in the same turn.
    fakes.model.script.push(call('create_ticket', TICKET), call('create_ticket', TICKET), say('Shall I submit this ticket?'));
    const first = await ask(agent, 'my order 1001 arrived damaged, demo@acme.example');
    expect(toolResults(1)[0]!.result).toMatchObject({ status: 'confirmation_required' });
    expect(toolResults(2)[0]!.result).toMatchObject({ status: 'confirmation_required' }); // no new customer message yet
    expect(await InboxItemModel.countDocuments()).toBe(0);

    // Turn 2: the customer says yes, and the same ticket is requested again: now it runs.
    fakes.model.script.push(call('create_ticket', TICKET), say('Done! Ticket T-0001.'));
    await ask(agent, 'yes please', first.conversationId);
    expect(toolResults(4)[0]!.result).toMatchObject({ ok: true, ticket: 'T-0001', alreadyExisted: false });
    const item = await InboxItemModel.findOne().lean();
    expect(item).toMatchObject({ kind: 'ticket', number: 1, summary: TICKET.summary, customerEmail: TICKET.email, status: 'open' });

    // The team got a real notification (to the account owner by default).
    expect(fakes.emails).toEqual([expect.objectContaining({ to: 'owner@acme.test', subject: expect.stringContaining('T-0001') })]);
  });

  it('asks again if the details change after the proposal', async () => {
    const agent = await signedUpBrowser();
    fakes.model.script.push(call('create_ticket', TICKET), say('Confirm?'));
    const first = await ask(agent, 'broken item');
    fakes.model.script.push(call('create_ticket', { ...TICKET, email: 'new@acme.example' }), say('Confirm the new email?'));
    await ask(agent, 'yes but use new@acme.example', first.conversationId);
    expect(toolResults(1)[0]!.result).toMatchObject({ status: 'confirmation_required' });
    expect(await InboxItemModel.countDocuments()).toBe(0);
  });

  it('a reworded "yes" still works, and creates exactly what the customer was shown', async () => {
    const agent = await signedUpBrowser();
    fakes.model.script.push(call('create_ticket', TICKET), say('Shall I submit it?'));
    const first = await ask(agent, 'my mug arrived broken');
    // Found in a real browser test: on "yes" the model asked again with different wording.
    const reworded = { ...TICKET, summary: 'Cracked mug in order 1001', details: 'Customer reports a cracked mug' };
    fakes.model.script.push(call('create_ticket', reworded), say('Done.'));
    await ask(agent, "yes that's right", first.conversationId);

    expect(toolResults(3)[0]!.result).toMatchObject({ ok: true, ticket: 'T-0001' });
    expect(await InboxItemModel.findOne().lean()).toMatchObject({ summary: TICKET.summary, details: TICKET.details });
  });

  it('never creates the same ticket twice in a conversation', async () => {
    const agent = await signedUpBrowser();
    const confirmTwice = async (conversationId?: string) => {
      fakes.model.script.push(call('create_ticket', TICKET), say('Confirm?'));
      const r = await ask(agent, 'broken item', conversationId);
      fakes.model.script.push(call('create_ticket', TICKET), say('Done.'));
      await ask(agent, 'yes', r.conversationId);
      return r.conversationId;
    };
    const conversationId = await confirmTwice();
    await confirmTwice(conversationId);
    expect(await InboxItemModel.countDocuments()).toBe(1);
    expect(toolResults(fakes.generated.length - 1)[0]!.result).toMatchObject({ alreadyExisted: true, ticket: 'T-0001' });
  });

  it('hands off to a human: flags the conversation and notifies the team', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    fakes.model.script.push(call('handoff_to_human', { reason: 'Customer asked for a person' }), say('A team member will follow up.'));
    const res = await ask(agent, 'I want to talk to a human');
    expect((await ConversationModel.findById(res.conversationId).lean())!.needsHuman).toBe(true);
    expect(await InboxItemModel.findOne().lean()).toMatchObject({ kind: 'handoff' });
    expect(fakes.emails).toHaveLength(1);
  });

  it(`stops after ${MAX_AGENT_STEPS} tool rounds and says so`, async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await connectShop();
    for (let i = 0; i < MAX_AGENT_STEPS + 2; i++) fakes.model.script.push(call('get_order_status', { orderId: '1001', email: 'a@b.example' }));
    const res = await ask(agent, 'loop forever');
    expect(fakes.generated).toHaveLength(MAX_AGENT_STEPS);
    expect(res.text).toContain(GIVE_UP_ANSWER);
  });

  it('tells the model about unknown tools instead of crashing', async () => {
    const agent = await signedUpBrowser();
    fakes.model.script.push(call('delete_all_orders', {}), say('I cannot do that.'));
    const res = await ask(agent, 'delete everything');
    expect(res.tools).toEqual(['delete_all_orders:running', 'delete_all_orders:failed']);
    expect(res.text).toBe('I cannot do that.');
  });
});

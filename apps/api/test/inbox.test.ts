import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConversationModel, InboxItemModel, WorkspaceModel } from '@support-agent/db';
import { app, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

async function addItem(workspaceName: string, summary: string) {
  const ws = await WorkspaceModel.findOne({ name: workspaceName });
  const conversation = await ConversationModel.create({
    workspaceId: ws!._id,
    title: 'x',
    messages: [{ role: 'user', content: 'it broke' }, { role: 'assistant', content: 'Ticket created.' }],
  });
  return InboxItemModel.create({ workspaceId: ws!._id, conversationId: conversation._id, number: 7, kind: 'ticket', summary, idempotencyKey: summary });
}

describe('inbox', () => {
  it('requires login', async () => {
    await request(app).get('/inbox').expect(401);
  });

  it('lists open items with the conversation they came from, and closes them', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const item = await addItem('Acme', 'Mug arrived cracked');

    const open = await agent.get('/inbox').expect(200);
    expect(open.body.items[0]).toMatchObject({ number: 'T-0007', kind: 'ticket', summary: 'Mug arrived cracked', status: 'open' });
    expect(open.body.items[0].transcript).toEqual([
      { role: 'user', content: 'it broke' },
      { role: 'assistant', content: 'Ticket created.' },
    ]);

    await agent.patch(`/inbox/${item._id}`).send({ status: 'closed' }).expect(200);
    expect((await agent.get('/inbox')).body.items).toHaveLength(0);
    expect((await agent.get('/inbox?status=closed')).body.items).toHaveLength(1);
  });

  it("never shows or changes another workspace's items", async () => {
    await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    const item = await addItem('A Corp', 'Alice private ticket');
    expect((await bob.get('/inbox')).body.items).toHaveLength(0);
    await bob.patch(`/inbox/${item._id}`).send({ status: 'closed' }).expect(404);
  });
});

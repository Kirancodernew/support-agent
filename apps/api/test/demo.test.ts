import { describe, expect, it } from 'vitest';
import { InboxItemModel, UserModel, WorkspaceModel } from '@support-agent/db';
import type { GenerateEvent } from '@support-agent/llm';
import { DEMO_CHAT_LIMITS } from '../src/lib/demo';
import { browser, fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

/** What the worker creates (see apps/worker/src/demo). */
async function seedDemo() {
  const ws = await WorkspaceModel.create({ name: 'Acme Home Store (demo)', isDemo: true });
  await UserModel.create({ email: 'demo-owner@example.com', passwordHash: 'unusable', workspaceId: ws._id });
  return ws;
}

async function demoBrowser() {
  const agent = browser();
  await agent.post('/auth/demo').expect(200);
  return agent;
}

describe('try the demo', () => {
  it('says so while the demo is not set up yet', async () => {
    await browser().post('/auth/demo').expect(503);
  });

  it('logs in to the demo workspace without a password', async () => {
    await seedDemo();
    const agent = browser();
    const res = await agent.post('/auth/demo').expect(200);
    expect(res.body.workspace).toMatchObject({ name: 'Acme Home Store (demo)', isDemo: true });
    expect((await agent.get('/auth/me').expect(200)).body.workspace.isDemo).toBe(true);
    // A normal account is not a demo.
    expect((await (await signedUpBrowser()).get('/auth/me')).body.workspace.isDemo).toBe(false);
  });

  it('can look at everything but change nothing that the next visitor would see', async () => {
    await seedDemo();
    const agent = await demoBrowser();
    for (const path of ['/documents', '/conversations', '/insights/summary?days=7', '/inbox', '/widget-settings', '/integrations', '/api-keys']) {
      await agent.get(path).expect(200);
    }
    // The demo shop's signing secret is never shown to visitors.
    await WorkspaceModel.updateOne({ isDemo: true }, { webhookSecret: 'whsec_real_demo_shop_secret' });
    expect((await agent.get('/integrations')).body.webhookSecret).toBe('hidden in the demo');
    const blocked = [
      agent.post('/documents').send({ filename: 'a.pdf', size: 10 }),
      agent.delete('/documents/6ad77bff1a97acea6a65fc7c'),
      agent.put('/widget-settings').send({ allowedOrigins: ['https://evil.example'] }),
      agent.post('/widget-settings/rotate-key'),
      agent.put('/integrations').send({ notifyEmail: 'someone@example.com' }),
      agent.post('/api-keys').send({ name: 'mine' }),
      agent.post('/workspace/delete').send({ password: 'x', confirmName: 'Acme Home Store (demo)' }),
    ];
    for (const res of await Promise.all(blocked)) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('demo_read_only');
    }
    expect(fakes.deletions).toEqual([]);
  });

  it('caps chat per visitor, and each visitor has their own allowance', async () => {
    await seedDemo();
    const first = await demoBrowser();
    for (let i = 0; i < DEMO_CHAT_LIMITS.perSessionPerHour; i++) await first.post('/chat').send({ message: `hi ${i}` }).expect(200);
    const limited = await first.post('/chat').send({ message: 'one more' }).expect(429);
    expect(limited.body.message).toMatch(/demo's message limit/);

    await (await demoBrowser()).post('/chat').send({ message: 'hello' }).expect(200);
  });

  it('never sends email, even when the agent hands off to a person', async () => {
    await seedDemo();
    const agent = await demoBrowser();
    const call: GenerateEvent[] = [{ type: 'toolCall', call: { id: 'c1', name: 'handoff_to_human', args: { reason: 'Customer asked' } } }];
    fakes.model.script.push(call, [{ type: 'text', text: 'A team member will follow up.' }]);
    await agent.post('/chat').send({ message: 'I want a person' }).expect(200);

    expect(await InboxItemModel.countDocuments({ kind: 'handoff' })).toBe(1);
    expect(fakes.emails).toEqual([]);
  });

  it("doesn't limit or restrict normal accounts", async () => {
    const agent = await signedUpBrowser();
    for (let i = 0; i <= DEMO_CHAT_LIMITS.perSessionPerHour; i++) await agent.post('/chat').send({ message: `hi ${i}` }).expect(200);
    await agent.post('/api-keys').send({ name: 'mine' }).expect(201);
  });
});

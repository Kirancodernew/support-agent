import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectDb, ConversationModel, disconnectDb, DocumentModel, InboxItemModel, nextSequence, UserModel, WorkspaceModel } from '@support-agent/db';
import type { Storage } from '@support-agent/storage';
import { DEMO_CHATS, DEMO_DOCUMENTS } from '../src/demo/content';
import { ensureDemo, resetDemo, type DemoDeps } from '../src/demo/demo';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
  await mongoose.connection.syncIndexes();
});
afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  files.clear();
  enqueued.length = 0;
});
afterAll(async () => {
  await disconnectDb();
  await mongo?.stop();
});

const files = new Map<string, string>();
const enqueued: string[] = [];
const storage: Storage = {
  presignUpload: async () => ({ url: '', fields: {} }),
  exists: async (key) => files.has(key),
  download: async () => new Uint8Array(),
  put: async (key, body) => void files.set(key, String(body)),
  remove: async (key) => void files.delete(key),
};
const deps: DemoDeps = {
  storage,
  enqueueIngest: async (id) => void enqueued.push(id),
  webUrl: 'https://support-agent.example',
  demoShopSecret: 'demo-shop-secret-123456',
};
const now = new Date('2026-10-20T12:00:00Z');

describe('demo workspace', () => {
  it('is created once: workspace, owner, and documents sent through the normal ingest path', async () => {
    const ws = await ensureDemo(deps);
    await ensureDemo(deps); // second boot: nothing new

    expect(await WorkspaceModel.countDocuments({ isDemo: true })).toBe(1);
    expect(await UserModel.countDocuments({ workspaceId: ws._id })).toBe(1);
    const docs = await DocumentModel.find({ workspaceId: ws._id }).lean();
    expect(docs.map((d) => d.filename).sort()).toEqual(DEMO_DOCUMENTS.map((d) => d.filename).sort());
    expect(docs.every((d) => d.status === 'queued' && files.get(d.s3Key)?.startsWith('#'))).toBe(true);
    expect(enqueued.sort()).toEqual(docs.map((d) => String(d._id)).sort());
  });

  it('resets to the sample chats, Inbox and settings, keeping the documents', async () => {
    const ws = await ensureDemo(deps);
    // What visitors did since the last reset.
    await ConversationModel.create({ workspaceId: ws._id, title: 'visitor chat', messages: [{ role: 'user', content: 'spam' }] });
    await nextSequence(`inbox:${String(ws._id)}`);
    await WorkspaceModel.updateOne({ _id: ws._id }, { notifyEmail: 'someone@example.com', allowedOrigins: ['https://evil.example'] });
    const docIds = (await DocumentModel.find({ workspaceId: ws._id }).lean()).map((d) => String(d._id)).sort();

    expect(await resetDemo(deps, now)).toEqual({ conversations: DEMO_CHATS.length, inboxItems: DEMO_CHATS.filter((c) => c.inbox).length });

    const chats = await ConversationModel.find({ workspaceId: ws._id }).lean();
    expect(chats).toHaveLength(DEMO_CHATS.length);
    expect(chats.some((c) => c.title === 'visitor chat')).toBe(false);
    // Dated relative to "now", so every period on the Insights page has data.
    expect(chats.every((c) => c.updatedAt <= now && c.updatedAt > new Date(now.getTime() - 14 * 24 * 3600_000))).toBe(true);
    const answers = chats.flatMap((c) => c.messages.filter((m) => m.role === 'assistant'));
    expect(answers.every((m) => m.questionKey && typeof m.unanswered === 'boolean' && m.firstTokenMs)).toBe(true);
    expect(answers.filter((m) => m.questionKey === 'do you have a student discount')).toHaveLength(3);

    // Inbox numbered in the order things happened, and new tickets continue from there.
    const inbox = await InboxItemModel.find({ workspaceId: ws._id }).sort({ createdAt: 1 }).lean();
    expect(inbox.map((i) => i.number)).toEqual([1, 2, 3, 4]);
    expect(await nextSequence(`inbox:${String(ws._id)}`)).toBe(5);

    const restored = (await WorkspaceModel.findById(ws._id).lean())!;
    expect(restored).toMatchObject({
      notifyEmail: null,
      allowedOrigins: ['https://support-agent.example'],
      orderWebhookUrl: 'https://support-agent.example/demo-shop/orders',
      webhookSecret: 'demo-shop-secret-123456',
    });
    expect(restored.publishableKey).toMatch(/^pk_live_/);
    expect((await DocumentModel.find({ workspaceId: ws._id }).lean()).map((d) => String(d._id)).sort()).toEqual(docIds);
  });

  it('keeps the widget key across resets, so an embedded demo widget keeps working', async () => {
    await resetDemo(deps, now);
    const key = (await WorkspaceModel.findOne({ isDemo: true }))!.publishableKey;
    await resetDemo(deps, now);
    expect((await WorkspaceModel.findOne({ isDemo: true }))!.publishableKey).toBe(key);
  });
});

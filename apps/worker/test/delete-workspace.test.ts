import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiKeyModel,
  ChunkModel,
  connectDb,
  ConversationModel,
  disconnectDb,
  DocumentModel,
  InboxItemModel,
  nextSequence,
  UserModel,
  WorkspaceModel,
} from '@support-agent/db';
import type { Storage } from '@support-agent/storage';
import { purgeDeletedWorkspaces, purgeWorkspace } from '../src/delete-workspace';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
});
afterEach(async () => {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  files.clear();
  failOn.key = null;
});
afterAll(async () => {
  await disconnectDb();
  await mongo?.stop();
});

const files = new Set<string>();
const failOn = { key: null as string | null };
const storage: Storage = {
  presignUpload: async () => ({ url: '', fields: {} }),
  exists: async (key) => files.has(key),
  download: async () => new Uint8Array(),
  put: async (key) => void files.add(key),
  remove: async (key) => {
    if (key === failOn.key) throw new Error('S3 unavailable');
    files.delete(key);
  },
};

/** A workspace with something in every collection it owns. */
async function seed(name: string, deleting = false) {
  const ws = await WorkspaceModel.create({ name, ...(deleting ? { deletingAt: new Date() } : {}) });
  const workspaceId = ws._id;
  await UserModel.create({ email: `${name}@test.dev`, passwordHash: 'x', workspaceId });
  const docs = await DocumentModel.create(
    [1, 2, 3].map((n) => ({ workspaceId, filename: `${n}.md`, contentType: 'text/markdown', size: 1, s3Key: `${name}/${n}.md`, status: 'ready' as const })),
  );
  for (const d of docs) {
    files.add(d.s3Key);
    await ChunkModel.create([0, 1].map((position) => ({ workspaceId, documentId: d._id, position, text: 't', embedding: [0.1] })));
  }
  const convo = await ConversationModel.create({ workspaceId, title: 'hi', channel: 'dashboard', messages: [{ role: 'user', content: 'hi' }] });
  await InboxItemModel.create({ workspaceId, conversationId: convo._id, number: 1, kind: 'ticket', summary: 's', idempotencyKey: 'k' });
  await ApiKeyModel.create({ workspaceId, name: 'k', prefix: 'sk', keyHash: `hash-${name}` });
  await nextSequence(`inbox:${String(workspaceId)}`);
  return String(workspaceId);
}

const owned = async (workspaceId: string) => {
  const wid = new mongoose.Types.ObjectId(workspaceId);
  return {
    workspace: await WorkspaceModel.countDocuments({ _id: wid }),
    users: await UserModel.countDocuments({ workspaceId: wid }),
    documents: await DocumentModel.countDocuments({ workspaceId: wid }),
    chunks: await ChunkModel.countDocuments({ workspaceId: wid }),
    conversations: await ConversationModel.countDocuments({ workspaceId: wid }),
    inboxItems: await InboxItemModel.countDocuments({ workspaceId: wid }),
    apiKeys: await ApiKeyModel.countDocuments({ workspaceId: wid }),
    counter: await mongoose.connection.db!.collection('counters').countDocuments({ _id: `inbox:${workspaceId}` as never }),
  };
};
const NOTHING = { workspace: 0, users: 0, documents: 0, chunks: 0, conversations: 0, inboxItems: 0, apiKeys: 0, counter: 0 };

describe('purgeWorkspace', () => {
  it('removes every file and record the workspace owns, and nothing of anyone else', async () => {
    const acme = await seed('acme', true);
    const other = await seed('other');

    const result = await purgeWorkspace(storage, acme);

    expect(result).toEqual({ files: 3, chunks: 6, documents: 3, conversations: 1, inboxItems: 1, apiKeys: 1, users: 1 });
    expect(await owned(acme)).toEqual(NOTHING);
    expect([...files].sort()).toEqual(['other/1.md', 'other/2.md', 'other/3.md']);
    expect(await owned(other)).toEqual({ workspace: 1, users: 1, documents: 3, chunks: 6, conversations: 1, inboxItems: 1, apiKeys: 1, counter: 1 });
  });

  it('can be retried after failing part-way, and the workspace stays marked until it finishes', async () => {
    const acme = await seed('acme', true);
    failOn.key = 'acme/2.md';

    await expect(purgeWorkspace(storage, acme)).rejects.toThrow('S3 unavailable');
    // Nothing deleted from the database yet, so the file list (our documents) is intact for the retry.
    expect((await owned(acme)).documents).toBe(3);
    expect(await WorkspaceModel.countDocuments({ deletingAt: { $type: 'date' } })).toBe(1);

    failOn.key = null;
    await purgeWorkspace(storage, acme);
    await purgeWorkspace(storage, acme); // a duplicate run is harmless
    expect(await owned(acme)).toEqual(NOTHING);
    expect(files.size).toBe(0);
  });
});

describe('purgeDeletedWorkspaces', () => {
  it('finishes only the workspaces marked for deletion', async () => {
    const acme = await seed('acme', true);
    const other = await seed('other');

    expect(await purgeDeletedWorkspaces(storage)).toEqual({ purged: 1 });
    expect(await owned(acme)).toEqual(NOTHING);
    expect((await owned(other)).workspace).toBe(1);
    expect(await purgeDeletedWorkspaces(storage)).toEqual({ purged: 0 });
  });
});

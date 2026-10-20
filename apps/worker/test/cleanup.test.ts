import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectDb, disconnectDb, DocumentModel, type DocumentStatus } from '@support-agent/db';
import type { Storage } from '@support-agent/storage';
import { cleanupStaleUploads, STALE_UPLOAD_MS } from '../src/cleanup';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
});
afterEach(async () => {
  await DocumentModel.deleteMany({});
  removedKeys.length = 0;
});
afterAll(async () => {
  await disconnectDb();
  await mongo?.stop();
});

const removedKeys: string[] = [];
const storage: Storage = {
  presignUpload: async () => ({ url: '', fields: {} }),
  exists: async () => true,
  download: async () => new Uint8Array(),
  put: async () => undefined,
  remove: async (key) => void removedKeys.push(key),
};

const now = new Date('2026-10-19T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

async function doc(status: DocumentStatus, createdAt: Date, key: string) {
  // timestamps: false so our backdated createdAt is kept.
  await DocumentModel.create(
    [{ workspaceId: new mongoose.Types.ObjectId(), filename: `${key}.pdf`, contentType: 'application/pdf', size: 1, s3Key: key, status, createdAt }],
    { timestamps: false },
  );
}

describe('cleanupStaleUploads', () => {
  it('removes abandoned uploads (record and file), and nothing else', async () => {
    await doc('uploading', minutesAgo(90), 'abandoned');
    await doc('uploading', minutesAgo(10), 'in-progress'); // someone is uploading right now
    await doc('ready', minutesAgo(600), 'old-but-done');
    await doc('failed', minutesAgo(600), 'old-failed');
    await doc('queued', minutesAgo(600), 'old-queued');

    expect(await cleanupStaleUploads(storage, now)).toEqual({ removed: 1 });
    expect(removedKeys).toEqual(['abandoned']);
    const left = (await DocumentModel.find().lean()).map((d) => d.s3Key).sort();
    expect(left).toEqual(['in-progress', 'old-but-done', 'old-failed', 'old-queued']);
  });

  it('uses a one-hour cutoff, well past the 5-minute upload link expiry', () => {
    expect(STALE_UPLOAD_MS).toBe(60 * 60 * 1000);
  });

  it('does nothing when there is nothing stale', async () => {
    await doc('ready', minutesAgo(600), 'fine');
    expect(await cleanupStaleUploads(storage, now)).toEqual({ removed: 0 });
    expect(removedKeys).toEqual([]);
  });
});

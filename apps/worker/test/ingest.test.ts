import { UnrecoverableError } from 'bullmq';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChunkModel, connectDb, disconnectDb, DocumentModel } from '@support-agent/db';
import type { Llm } from '@support-agent/llm';
import type { Storage } from '@support-agent/storage';
import { createIngestProcessor, failureMessage, isFinalFailure } from '../src/ingest';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
});
afterEach(async () => {
  await Promise.all([DocumentModel.deleteMany({}), ChunkModel.deleteMany({})]);
});
afterAll(async () => {
  await disconnectDb();
  await mongo?.stop();
});

const files = new Map<string, Uint8Array>();
const storage: Storage = {
  presignUpload: async () => ({ url: '', fields: {} }),
  exists: async (k) => files.has(k),
  download: async (k) => files.get(k) ?? new Uint8Array(),
  remove: async (k) => void files.delete(k),
};
// The ingest job only embeds; it never generates text.
const llm: Llm = {
  embed: async (texts) => texts.map((t) => [t.length, 1, 0]),
  generateStream: async function* () {},
};

async function uploadedDoc(text: string) {
  const doc = await DocumentModel.create({
    workspaceId: new mongoose.Types.ObjectId(),
    filename: 'notes.txt',
    contentType: 'text/plain',
    size: text.length,
    s3Key: `k/${new mongoose.Types.ObjectId()}`,
    status: 'queued',
  });
  files.set(doc.s3Key, new TextEncoder().encode(text));
  return doc;
}

const longText = Array.from({ length: 60 }, (_, i) => `Fact ${i}: the product does thing number ${i} well.`).join('\n\n');

describe('ingest job', () => {
  it('turns a document into embedded chunks and marks it ready', async () => {
    const doc = await uploadedDoc(longText);
    const result = await createIngestProcessor({ storage, llm })({ data: { documentId: String(doc._id) } });

    const chunks = await ChunkModel.find({ documentId: doc._id }).sort({ position: 1 }).lean();
    expect(result).toEqual({ chunks: chunks.length });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => String(c.workspaceId) === String(doc.workspaceId))).toBe(true);
    expect(chunks[0]!.embedding).toHaveLength(3);

    const after = await DocumentModel.findById(doc._id);
    expect(after).toMatchObject({ status: 'ready', chunkCount: chunks.length, error: null });
  });

  it('is safe to run twice: a retry replaces chunks instead of duplicating them', async () => {
    const doc = await uploadedDoc(longText);
    const process = createIngestProcessor({ storage, llm });
    const first = await process({ data: { documentId: String(doc._id) } });
    await process({ data: { documentId: String(doc._id) } });
    expect(await ChunkModel.countDocuments({ documentId: doc._id })).toBe((first as { chunks: number }).chunks);
  });

  it('skips a document deleted before the job ran', async () => {
    const id = String(new mongoose.Types.ObjectId());
    expect(await createIngestProcessor({ storage, llm })({ data: { documentId: id } })).toEqual({ skipped: 'deleted' });
  });

  it('leaves no chunks behind if the document is deleted while processing', async () => {
    const doc = await uploadedDoc(longText);
    const deletingLlm: Llm = {
      ...llm,
      embed: async (texts) => {
        await DocumentModel.deleteOne({ _id: doc._id }); // user clicks delete mid-way
        return llm.embed(texts, 'document');
      },
    };
    const result = await createIngestProcessor({ storage, llm: deletingLlm })({ data: { documentId: String(doc._id) } });
    expect(result).toEqual({ skipped: 'deleted' });
    expect(await ChunkModel.countDocuments({ documentId: doc._id })).toBe(0);
  });

  it('fails permanently, with a readable reason, when there is no text', async () => {
    const doc = await uploadedDoc('   \n\n  ');
    const err = await createIngestProcessor({ storage, llm })({ data: { documentId: String(doc._id) } }).catch((e) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, err)).toBe(true);
    expect(failureMessage(err)).toMatch(/No text found/);
  });

  it('retries ordinary errors and hides their details from the user', () => {
    const err = new Error('ECONNRESET talking to Gemini');
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, err)).toBe(false);
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } }, err)).toBe(true);
    expect(failureMessage(err)).not.toContain('ECONNRESET');
  });
});

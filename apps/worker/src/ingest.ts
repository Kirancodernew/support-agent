import { UnrecoverableError, type Job } from 'bullmq';
import { ChunkModel, DocumentModel } from '@support-agent/db';
import type { Llm } from '@support-agent/llm';
import type { IngestJob } from '@support-agent/queue';
import type { Storage } from '@support-agent/storage';
import { chunkText } from './chunk';
import { extractText } from './extract';

// ~400 chunks ≈ 400k characters ≈ a 150-page document. Keeps free-tier embedding usage sane.
export const MAX_CHUNKS = 400;

export type IngestDeps = { storage: Storage; llm: Llm };
export type IngestResult = { chunks: number } | { skipped: 'deleted' };

/** download → extract → chunk → embed → save. Safe to run more than once for the same document. */
export function createIngestProcessor({ storage, llm }: IngestDeps) {
  return async (job: Pick<Job<IngestJob>, 'data'>): Promise<IngestResult> => {
    const doc = await DocumentModel.findById(job.data.documentId);
    if (!doc) return { skipped: 'deleted' };
    await DocumentModel.updateOne({ _id: doc._id }, { status: 'processing', error: null });

    const text = await extractText(await storage.download(doc.s3Key), doc.contentType);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new UnrecoverableError('No text found in this file. Scanned PDFs (images of text) are not supported yet.');
    }
    if (chunks.length > MAX_CHUNKS) {
      throw new UnrecoverableError('This document is too long. Split it into smaller files (about 150 pages each).');
    }

    const vectors = await llm.embed(chunks, 'document');
    if (vectors.length !== chunks.length) throw new Error(`got ${vectors.length} embeddings for ${chunks.length} chunks`);

    // Idempotent: a retried job replaces this document's chunks instead of duplicating them.
    await ChunkModel.deleteMany({ documentId: doc._id });
    await ChunkModel.insertMany(
      chunks.map((chunk, position) => ({
        workspaceId: doc.workspaceId,
        documentId: doc._id,
        position,
        text: chunk,
        embedding: vectors[position],
      })),
    );

    const updated = await DocumentModel.updateOne(
      { _id: doc._id },
      { status: 'ready', chunkCount: chunks.length, error: null },
    );
    if (updated.matchedCount === 0) {
      // Deleted while we were working: don't leave orphaned chunks behind.
      await ChunkModel.deleteMany({ documentId: doc._id });
      return { skipped: 'deleted' };
    }
    return { chunks: chunks.length };
  };
}

/** No more retries will happen: either the error says retrying is pointless, or attempts ran out. */
export function isFinalFailure(job: Pick<Job, 'attemptsMade' | 'opts'>, err: Error) {
  return err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
}

/** What the user sees. Our own messages are shown as-is; internal errors are not leaked. */
export function failureMessage(err: Error) {
  return err instanceof UnrecoverableError || err.name === 'UnrecoverableError'
    ? err.message
    : 'Processing failed after several tries. Delete it and upload again.';
}

export async function markFailed(documentId: string, message: string) {
  await DocumentModel.updateOne({ _id: documentId }, { status: 'failed', error: message });
}

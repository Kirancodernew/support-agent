import { ChunkModel, type Retriever } from '@support-agent/db';
import type { Llm } from '@support-agent/llm';
import type { IngestQueue } from '@support-agent/queue';
import type { Storage } from '@support-agent/storage';
import type { AppDeps } from '../src/deps';

/** Word-count "embedding": texts sharing words get similar vectors. Enough to test ranking. */
export function fakeEmbed(text: string): number[] {
  const v = new Array<number>(32).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const c of word) h = (h * 31 + c.charCodeAt(0)) % 32;
    v[h] = (v[h] ?? 0) + 1;
  }
  return v;
}

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return dot / (norm(a) * norm(b));
};

/** In-memory stand-ins for S3, the job queue, Gemini and Atlas Vector Search. */
export function createFakes() {
  const files = new Map<string, Uint8Array>();
  const enqueued: string[] = [];

  const storage: Storage = {
    presignUpload: async (key, contentType) => ({ url: 'https://s3.test/upload', fields: { key, 'Content-Type': contentType } }),
    exists: async (key) => files.has(key),
    download: async (key) => {
      const file = files.get(key);
      if (!file) throw new Error(`no such file: ${key}`);
      return file;
    },
    remove: async (key) => {
      files.delete(key);
    },
  };
  const ingestQueue: IngestQueue = {
    enqueue: async (documentId) => {
      enqueued.push(documentId);
    },
  };
  const llm: Llm = { embed: async (texts) => texts.map(fakeEmbed) };
  // Same contract as the Atlas retriever, including the workspace filter.
  const retriever: Retriever = {
    search: async (workspaceId, vector, limit) => {
      const chunks = await ChunkModel.find({ workspaceId }).lean();
      return chunks
        .map((c) => ({ documentId: String(c.documentId), position: c.position, text: c.text, score: cosine(vector, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };

  const deps: AppDeps = { storage, ingestQueue, llm, retriever };
  return {
    deps,
    files,
    enqueued,
    reset() {
      files.clear();
      enqueued.length = 0;
    },
  };
}

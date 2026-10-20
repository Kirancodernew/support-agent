import { ChunkModel, type Retriever } from '@support-agent/db';
import { LlmBusyError, type GenerateEvent, type GenerateRequest, type Llm } from '@support-agent/llm';
import type { IngestQueue, JobQueue } from '@support-agent/queue';
import type { Storage } from '@support-agent/storage';
import type { Notifier } from '../src/agent/notifier';
import type { OrderLookup, OrderQuery, OrderResult } from '../src/agent/order-lookup';
import type { AppDeps } from '../src/deps';
import type { RateLimiter } from '../src/lib/rate-limit';

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
  const deletions: string[] = [];
  const queueState = { down: false };

  const storage: Storage = {
    presignUpload: async (key, contentType) => ({ url: 'https://s3.test/upload', fields: { key, 'Content-Type': contentType } }),
    exists: async (key) => files.has(key),
    download: async (key) => {
      const file = files.get(key);
      if (!file) throw new Error(`no such file: ${key}`);
      return file;
    },
    put: async (key, body) => {
      files.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : body);
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
  const jobs: JobQueue = {
    deleteWorkspace: async (workspaceId) => {
      if (queueState.down) throw new Error('redis unavailable');
      deletions.push(workspaceId);
    },
  };
  // The fake model. By default it "answers" with two text pieces. Tests can script each model
  // call (e.g. "call get_order_status", then "say X"); every request is recorded so tests can
  // check what the prompt contained. Set `fail` to make it break after the first piece, `busy` to
  // make the provider refuse before answering (overloaded / timed out).
  const generated: GenerateRequest[] = [];
  const model = {
    pieces: ['Standard shipping ', 'takes 3 to 5 days [1].'],
    script: [] as GenerateEvent[][],
    fail: false,
    busy: false,
  };
  const llm: Llm = {
    embed: async (texts) => texts.map(fakeEmbed),
    async *generateStream(request) {
      generated.push({ ...request, turns: [...request.turns] });
      if (model.busy) throw new LlmBusyError('provider overloaded');
      const step = model.script.shift() ?? model.pieces.map((text): GenerateEvent => ({ type: 'text', text }));
      for (const [i, event] of step.entries()) {
        if (model.fail && i === 1) throw new Error('model exploded');
        yield event;
      }
      yield { type: 'end', providerParts: ['raw-reply'] };
    },
  };
  const orderCalls: { url: string; query: OrderQuery }[] = [];
  const orderResult: { next: OrderResult } = { next: { found: true, order: { id: '1001', status: 'Shipped', eta: 'Arrives 21 Oct' } } };
  const orders: OrderLookup = {
    lookup: async ({ url }, query) => {
      orderCalls.push({ url, query });
      return orderResult.next;
    },
  };
  const emails: { to: string; subject: string; text: string }[] = [];
  const notifier: Notifier = { notify: async (m) => void emails.push(m) };
  const hits = new Map<string, number>();
  const rateLimiter: RateLimiter = {
    hit: async (key, limit) => {
      const count = (hits.get(key) ?? 0) + 1;
      hits.set(key, count);
      return { allowed: count <= limit, retryAfterSeconds: 42 };
    },
  };
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

  // Fake vectors are word counts, so related texts score lower than real embeddings would.
  const deps: AppDeps = { storage, ingestQueue, jobs, llm, retriever, rateLimiter, chat: { minScore: 0.3 }, orders, notifier };
  return {
    deps,
    files,
    enqueued,
    deletions,
    queueState,
    generated,
    model,
    orderCalls,
    orderResult,
    emails,
    reset() {
      files.clear();
      enqueued.length = 0;
      deletions.length = 0;
      queueState.down = false;
      generated.length = 0;
      hits.clear();
      model.fail = false;
      model.busy = false;
      model.script.length = 0;
      orderCalls.length = 0;
      emails.length = 0;
      orderResult.next = { found: true, order: { id: '1001', status: 'Shipped', eta: 'Arrives 21 Oct' } };
    },
  };
}

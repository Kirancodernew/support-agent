import type { Retriever } from '@support-agent/db';
import type { Llm } from '@support-agent/llm';
import type { IngestQueue, JobQueue } from '@support-agent/queue';
import type { Storage } from '@support-agent/storage';
import type { Notifier } from './agent/notifier';
import type { OrderLookup } from './agent/order-lookup';
import type { RateLimiter } from './lib/rate-limit';

/**
 * Everything the routes need from the outside world. index.ts passes the real services;
 * tests pass in-memory fakes, so they run without S3, Redis, Gemini or Atlas Search.
 */
export type AppDeps = {
  storage: Storage;
  ingestQueue: IngestQueue;
  jobs: JobQueue;
  llm: Llm;
  retriever: Retriever;
  rateLimiter: RateLimiter;
  /** Calls the business's order system (signed webhook). */
  orders: OrderLookup;
  /** Emails the business's team about tickets and handoffs. */
  notifier: Notifier;
  chat: {
    /** Passages scoring below this are ignored; with none left, the answer is "I don't know". */
    minScore: number;
  };
};

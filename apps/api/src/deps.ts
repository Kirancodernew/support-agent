import type { Retriever } from '@support-agent/db';
import type { Llm } from '@support-agent/llm';
import type { IngestQueue } from '@support-agent/queue';
import type { Storage } from '@support-agent/storage';

/**
 * Everything the routes need from the outside world. index.ts passes the real services;
 * tests pass in-memory fakes, so they run without S3, Redis, Gemini or Atlas Search.
 */
export type AppDeps = {
  storage: Storage;
  ingestQueue: IngestQueue;
  llm: Llm;
  retriever: Retriever;
};

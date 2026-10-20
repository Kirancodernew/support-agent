import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export type { Redis };

// Queue names and job shapes live in one place so producers (API) and consumers (worker) can't drift.
export const QUEUES = { system: 'system', ingest: 'ingest' } as const;

/** Jobs on the system queue: health pings and scheduled housekeeping. */
export const SYSTEM_JOBS = {
  ping: 'ping',
  cleanupStaleUploads: 'cleanup-stale-uploads',
  deleteWorkspace: 'delete-workspace',
  purgeDeletedWorkspaces: 'purge-deleted-workspaces',
  resetDemo: 'reset-demo',
} as const;

export type PingJob = { sentAt: number };
export type PingResult = { pong: true; latencyMs: number };
export type IngestJob = { documentId: string };
export type DeleteWorkspaceJob = { workspaceId: string };

// BullMQ blocks on Redis while waiting for jobs, so ioredis must never give up on a command.
export function createRedis(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export const INGEST_ATTEMPTS = 3;

export function createIngestQueue(connection: Redis) {
  const queue = new Queue<IngestJob>(QUEUES.ingest, { connection });
  return {
    enqueue: (documentId: string) =>
      queue.add(
        'ingest',
        { documentId },
        {
          // jobId = documentId: enqueueing the same document twice is a no-op, not a second job.
          jobId: documentId,
          attempts: INGEST_ATTEMPTS,
          // 5s, 10s, 20s between tries: rides out short outages and rate limits.
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      ),
    close: () => queue.close(),
  };
}

/** What the API needs from the queue; tests substitute an in-memory fake. */
export type IngestQueue = { enqueue(documentId: string): Promise<unknown> };

export function createSystemQueue(connection: Redis) {
  const queue = new Queue(QUEUES.system, { connection });
  return {
    deleteWorkspace: (workspaceId: string) =>
      queue.add(
        SYSTEM_JOBS.deleteWorkspace,
        { workspaceId } satisfies DeleteWorkspaceJob,
        {
          // BullMQ rejects ":" in custom ids (it uses ":" in its own Redis keys).
          jobId: `${SYSTEM_JOBS.deleteWorkspace}-${workspaceId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      ),
    close: () => queue.close(),
  };
}

/** Background jobs the API starts; tests substitute an in-memory fake. */
export type JobQueue = { deleteWorkspace(workspaceId: string): Promise<unknown> };

import { Worker } from 'bullmq';
import { connectDb, disconnectDb } from '@support-agent/db';
import { createLlm } from '@support-agent/llm';
import { createRedis, QUEUES, type IngestJob, type PingJob, type PingResult } from '@support-agent/queue';
import { createS3Storage } from '@support-agent/storage';
import { env } from './env';
import { createIngestProcessor, failureMessage, isFinalFailure, markFailed, type IngestResult } from './ingest';
import { logger } from './logger';

try {
  await connectDb(env.MONGODB_URI);
  logger.info('connected to MongoDB');
} catch (err) {
  logger.fatal({ err }, 'could not connect to MongoDB');
  process.exit(1);
}

// One Redis connection per worker: each holds a blocking "wait for a job" command open.
const systemConn = createRedis(env.REDIS_URL);
const ingestConn = createRedis(env.REDIS_URL);

const systemWorker = new Worker<PingJob, PingResult>(
  QUEUES.system,
  async (job) => {
    if (job.name !== 'ping') throw new Error(`unknown job: ${job.name}`);
    return { pong: true, latencyMs: Date.now() - job.data.sentAt };
  },
  { connection: systemConn, concurrency: 5 },
);

const ingestWorker = new Worker<IngestJob, IngestResult>(
  QUEUES.ingest,
  createIngestProcessor({
    storage: createS3Storage({
      region: env.AWS_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    }),
    llm: createLlm({ provider: env.LLM_PROVIDER, apiKey: env.GEMINI_API_KEY, embedModel: env.GEMINI_EMBED_MODEL }),
  }),
  // One document at a time keeps us inside Gemini's free-tier rate limits.
  { connection: ingestConn, concurrency: 1 },
);

for (const w of [systemWorker, ingestWorker]) {
  w.on('ready', () => logger.info(`worker listening on queue "${w.name}"`));
}
ingestWorker.on('completed', (job, result) => logger.info({ jobId: job.id, result }, 'document processed'));
ingestWorker.on('failed', (job, err) => {
  if (!job) return;
  const final = isFinalFailure(job, err);
  logger.error({ jobId: job.id, attempt: job.attemptsMade, final, err }, 'document processing failed');
  if (final) {
    markFailed(job.data.documentId, failureMessage(err)).catch((e: unknown) =>
      logger.error({ err: e }, 'could not mark document failed'),
    );
  }
});

// Let the current job finish before exiting on redeploy.
async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await Promise.allSettled([systemWorker.close(), ingestWorker.close()]);
  await Promise.allSettled([systemConn.quit(), ingestConn.quit(), disconnectDb()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

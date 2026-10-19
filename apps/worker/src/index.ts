import { Worker } from 'bullmq';
import { logger } from './logger';
import { createRedis, QUEUES, type PingJob, type PingResult } from './queues';

const connection = createRedis();

// Phase 0 only handles `ping`, which proves API/scripts -> Redis -> worker works.
// Phase 2 adds the document-ingestion processor on its own queue.
const worker = new Worker<PingJob, PingResult>(
  QUEUES.system,
  async (job) => {
    if (job.name !== 'ping') throw new Error(`unknown job: ${job.name}`);
    return { pong: true, latencyMs: Date.now() - job.data.sentAt };
  },
  { connection, concurrency: 5 },
);

worker.on('ready', () => logger.info(`worker listening on queue "${QUEUES.system}"`));
worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'job completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'job failed'));

// Let the current job finish before exiting on redeploy.
async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

import { connectDb, createAtlasRetriever, disconnectDb, ensureVectorIndex } from '@support-agent/db';
import { createLlm, EMBEDDING_DIMENSIONS } from '@support-agent/llm';
import { createIngestQueue, createRedis } from '@support-agent/queue';
import { createS3Storage } from '@support-agent/storage';
import { createResendNotifier, noopNotifier } from './agent/notifier';
import { createWebhookOrderLookup } from './agent/order-lookup';
import { createApp } from './app';
import { createRedisRateLimiter } from './lib/rate-limit';
import { env } from './env';
import { logger } from './logger';

// Connect before accepting traffic: the healthcheck only passes once the API can really serve.
try {
  await connectDb(env.MONGODB_URI);
  logger.info('connected to MongoDB');
} catch (err) {
  logger.fatal({ err }, 'could not connect to MongoDB');
  process.exit(1);
}

// Idempotent: creates the Atlas vector index on first boot, no-op afterwards.
await ensureVectorIndex(EMBEDDING_DIMENSIONS)
  .then((result) => logger.info({ result }, 'vector index checked'))
  .catch((err: unknown) => logger.warn({ err }, 'could not ensure vector index; search will fail until it exists'));

const redis = createRedis(env.REDIS_URL);
const ingestQueue = createIngestQueue(redis);

const app = createApp({
  storage: createS3Storage({
    region: env.AWS_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  }),
  ingestQueue,
  llm: createLlm({
    provider: env.LLM_PROVIDER,
    apiKey: env.GEMINI_API_KEY,
    embedModel: env.GEMINI_EMBED_MODEL,
    chatModel: env.GEMINI_CHAT_MODEL,
  }),
  retriever: createAtlasRetriever(),
  rateLimiter: createRedisRateLimiter(redis),
  chat: { minScore: env.CHAT_MIN_SCORE },
  // http://localhost webhooks are allowed only in local development (the demo shop runs there).
  orders: createWebhookOrderLookup({ allowLocalHttp: env.NODE_ENV === 'development' }),
  notifier: env.RESEND_API_KEY ? createResendNotifier({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : noopNotifier,
});

const server = app.listen(env.PORT, () => {
  logger.info(`api listening on http://localhost:${env.PORT}`);
});

// Hosts send SIGTERM on redeploy: stop taking new connections, finish in-flight requests, then exit.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.allSettled([ingestQueue.close(), disconnectDb()])
      .then(() => redis.quit())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

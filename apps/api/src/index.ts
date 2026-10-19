import { createApp } from './app';
import { connectDb, disconnectDb } from './db';
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

const server = createApp().listen(env.PORT, () => {
  logger.info(`api listening on http://localhost:${env.PORT}`);
});

// Hosts send SIGTERM on redeploy: stop taking new connections, finish in-flight requests, then exit.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void disconnectDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

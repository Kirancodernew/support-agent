import { createApp } from './app';
import { env } from './env';
import { logger } from './logger';

const server = createApp().listen(env.PORT, () => {
  logger.info(`api listening on http://localhost:${env.PORT}`);
});

// Hosts send SIGTERM on redeploy: stop taking new connections, finish in-flight requests, then exit.
function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

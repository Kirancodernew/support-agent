import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from './logger';

const startedAt = Date.now();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // Liveness: the process is up and serving. The host uses this to decide restarts.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'api', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}

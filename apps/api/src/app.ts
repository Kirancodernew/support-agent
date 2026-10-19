import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { AppDeps } from './deps';
import { HttpError } from './lib/http-error';
import { logger } from './logger';
import { apiKeysRouter } from './routes/api-keys';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { documentsRouter } from './routes/documents';
import { searchRouter } from './routes/search';

const startedAt = Date.now();

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  // Liveness: the process is up and serving. The host uses this to decide restarts.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'api', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  app.use('/auth', authRouter);
  app.use('/api-keys', apiKeysRouter);
  app.use('/documents', documentsRouter(deps));
  app.use('/search', searchRouter(deps));
  app.use('/chat', chatRouter(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found' });
  });

  // Express 5 forwards errors thrown in async handlers here automatically.
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
      return;
    }
    // Client mistakes raised by Express itself, e.g. malformed JSON (400) or a body over the limit (413).
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: 'bad_request', message: 'Invalid request' });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    // Never leak internals (stack traces, DB errors) to the client.
    res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
  };
  app.use(onError);

  return app;
}

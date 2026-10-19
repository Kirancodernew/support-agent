import { pino } from 'pino';
import { env } from './env';

// Request logs include headers. Session cookies and auth headers are credentials: anyone who
// can read the logs could replay them, so they're masked before a line is written.
export const LOG_REDACT = {
  paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]'],
  censor: '[redacted]',
};

// JSON logs in production (searchable on the host); readable colored logs locally.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api' },
  redact: LOG_REDACT,
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

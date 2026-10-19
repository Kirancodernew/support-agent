import { pino } from 'pino';
import { env } from './env';

// JSON logs in production (searchable on the host); readable colored logs locally.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

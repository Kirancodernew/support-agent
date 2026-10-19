import { pino } from 'pino';
import { env } from './env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'worker' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

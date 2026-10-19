import { loadEnv, z } from '@support-agent/config';

export const env = loadEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    REDIS_URL: z.string().startsWith('redis'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
);

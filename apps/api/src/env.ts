import { loadEnv, z } from '@support-agent/config';

export const env = loadEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MONGODB_URI: z.string().startsWith('mongodb'),
    // Signs session tokens. Anyone with it can forge a login, so it must be long and random.
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)'),
  }),
);

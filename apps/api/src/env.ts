import { loadEnv, z } from '@support-agent/config';

export const env = loadEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    MONGODB_URI: z.string().startsWith('mongodb'),
    // Signs session tokens. Anyone with it can forge a login, so it must be long and random.
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters (openssl rand -hex 32)'),
    // Parsed as a real URL so a stray quote or typo fails here with a clear message, instead of
    // inside ioredis, whose error prints the whole URL (password included) into the logs.
    REDIS_URL: z.url({ protocol: /^rediss?$/, error: 'must be a valid redis:// URL' }),
    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    LLM_PROVIDER: z.enum(['gemini']).default('gemini'),
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  }),
);

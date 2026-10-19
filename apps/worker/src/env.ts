import { loadEnv, z } from '@support-agent/config';

export const env = loadEnv(
  z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    REDIS_URL: z.string().startsWith('redis'),
    MONGODB_URI: z.string().startsWith('mongodb'),
    AWS_REGION: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    LLM_PROVIDER: z.enum(['gemini']).default('gemini'),
    GEMINI_API_KEY: z.string().min(1),
    GEMINI_EMBED_MODEL: z.string().default('gemini-embedding-001'),
  }),
);

import { Redis } from 'ioredis';
import { env } from './env';

// Queue names live in one place so producers (API) and consumers (worker) can't drift.
export const QUEUES = { system: 'system' } as const;

export type PingJob = { sentAt: number };
export type PingResult = { pong: true; latencyMs: number };

// BullMQ workers block on Redis, so ioredis must not give up on long-running commands.
export function createRedis() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

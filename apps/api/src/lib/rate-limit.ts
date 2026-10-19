import { randomBytes } from 'node:crypto';
import type { Redis } from '@support-agent/queue';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one hit for `key`; refuses once `limit` hits happened in the last `windowSeconds`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/*
 * Sliding window: a sorted set per key holding one timestamp per allowed hit.
 * 1. drop timestamps older than the window   2. count what's left
 * 3. over the limit? refuse, and say when the oldest hit leaves the window
 * 4. otherwise record this hit.
 * It runs as one Lua script, so concurrent requests can't both squeeze into the last free slot.
 * Unlike a fixed window (one counter per clock minute), there's no double burst at 0:59 + 1:00.
 */
const SLIDING_WINDOW = `
local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
if redis.call('ZCARD', key) >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2]) + window - now}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, 0}
`;

export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const member = `${now}-${randomBytes(4).toString('hex')}`; // unique even within one millisecond
      const [allowed, retryAfterMs] = (await redis.eval(
        SLIDING_WINDOW,
        1,
        `ratelimit:${key}`,
        now,
        windowMs,
        limit,
        member,
      )) as [number, number];
      return { allowed: allowed === 1, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    },
  };
}

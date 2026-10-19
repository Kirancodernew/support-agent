import type { Redis } from '@support-agent/queue';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one hit for `key`; refuses once `limit` hits happen within the current window. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Fixed-window counter in Redis: one key per key+window, INCR on each hit, expires with the window.
 * Shared by every API instance (unlike an in-memory counter). Phase 4 upgrades this to a
 * sliding window, which doesn't allow a double burst at a window boundary.
 */
export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    async hit(key, limit, windowSeconds) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const window = Math.floor(nowSeconds / windowSeconds);
      const redisKey = `ratelimit:${key}:${window}`;
      const results = await redis.multi().incr(redisKey).expire(redisKey, windowSeconds).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      return { allowed: count <= limit, retryAfterSeconds: windowSeconds - (nowSeconds % windowSeconds) };
    },
  };
}

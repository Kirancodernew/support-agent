import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { createRedisRateLimiter } from '../src/lib/rate-limit';

// The sliding window is a Lua script, so it's tested against a real Redis (the local Docker one).
// Skipped automatically when no Redis is reachable.
const url = process.env.REDIS_TEST_URL ?? 'redis://localhost:6379';
const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000 });
const available = await redis.connect().then(
  () => true,
  () => false,
);
afterAll(() => redis.disconnect());

describe.skipIf(!available)('sliding-window rate limiter (real Redis)', () => {
  const limiter = createRedisRateLimiter(redis);
  const key = () => `test:${Date.now()}:${Math.random()}`;

  it('allows up to the limit, then refuses with a retry time', async () => {
    const k = key();
    const results = await Promise.all(Array.from({ length: 7 }, () => limiter.hit(k, 5, 60)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const refused = results.find((r) => !r.allowed)!;
    expect(refused.retryAfterSeconds).toBeGreaterThan(55);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('frees a slot as soon as the oldest hit leaves the window', async () => {
    const k = key();
    await limiter.hit(k, 2, 1);
    await limiter.hit(k, 2, 1);
    expect((await limiter.hit(k, 2, 1)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await limiter.hit(k, 2, 1)).allowed).toBe(true);
  });

  it("refused hits don't count against the limit", async () => {
    const k = key();
    await limiter.hit(k, 1, 60);
    for (let i = 0; i < 5; i++) await limiter.hit(k, 1, 60);
    expect(await redis.zcard(`ratelimit:${k}`)).toBe(1);
  });
});

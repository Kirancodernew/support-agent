import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup-env.ts'],
    // Real bcrypt + an in-memory MongoDB: give slow first runs (binary download) room.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

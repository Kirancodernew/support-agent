import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

export { z };

// Local dev: npm runs each app from its own folder, so walk up to the repo-root .env.
// Deployed: the host (Railway/Vercel) injects env vars and there is no .env file.
function findEnvFile(start = process.cwd()): string | undefined {
  let dir = start;
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Loads .env (if present) and validates process.env against the app's schema.
 * Exits on invalid config so a misconfigured deploy fails at boot, not on the first request.
 */
export function loadEnv<S extends z.ZodType>(schema: S): z.infer<S> {
  const file = findEnvFile();
  if (file) loadDotenv({ path: file, quiet: true });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`Invalid environment variables:\n${problems}`);
    process.exit(1);
  }
  return parsed.data;
}

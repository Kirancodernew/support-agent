// Prints the variables a Railway service needs, read from your local .env, ready to paste into
// Railway's Raw Editor. Pipe it to the clipboard so secrets are never shown on screen:
//   node scripts/railway-env.mjs worker | pbcopy
// JWT_SECRET is never included: production must use its own secret.
import { readFileSync } from 'node:fs';

const NEEDS = {
  api: ['REDIS_URL', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET', 'GEMINI_API_KEY'],
  worker: ['MONGODB_URI', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET', 'GEMINI_API_KEY'],
};

const service = process.argv[2];
if (!(service in NEEDS)) {
  console.error(`usage: node scripts/railway-env.mjs <${Object.keys(NEEDS).join('|')}>`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
// Locally REDIS_URL is the Docker Redis; deployed services use Redis Cloud.
env.REDIS_URL = env.REDIS_CLOUD_URL;

const missing = NEEDS[service].filter((k) => !env[k]);
if (missing.length) {
  console.error(`missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}
process.stdout.write(NEEDS[service].map((k) => `${k}=${env[k]}`).join('\n') + '\n');

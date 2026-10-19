import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'sk_live_';

/**
 * Creates a new secret key. Only the SHA-256 hash is stored; the full key is shown once.
 * A fast hash is fine here (unlike passwords): the key has 192 random bits, so it can't be guessed.
 */
export function generateApiKey() {
  const key = PREFIX + randomBytes(24).toString('base64url');
  return { key, hash: hashApiKey(key), prefix: key.slice(0, PREFIX.length + 4) };
}

export function hashApiKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

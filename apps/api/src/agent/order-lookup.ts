import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from '@support-agent/config';

export type OrderQuery = { orderId: string; email: string };
export type OrderResult =
  | { found: true; order: { id: string; status: string; eta?: string; items?: string[] } }
  | { found: false };

/** Looks up an order in the business's own system. */
export interface OrderLookup {
  lookup(endpoint: { url: string; secret: string }, query: OrderQuery): Promise<OrderResult>;
}

/** HMAC-SHA256 over "timestamp.body". The business recomputes it with the shared secret. */
export function signWebhook(secret: string, timestamp: string, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// --- SSRF guard ---------------------------------------------------------------------------
// The webhook URL is typed in by a customer, and our *server* fetches it. Without checks, someone
// could point it at http://169.254.169.254 (cloud metadata, which can leak credentials), at
// localhost admin ports, or at our private network. Only public https addresses are allowed.

function isPrivateIPv4(ip: string) {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || // "this" network, private, loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7)); // IPv4-mapped
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') // link-local
  );
}

export class UnsafeUrlError extends Error {}

/**
 * Throws unless the URL is https and every address its host resolves to is public.
 * (A determined attacker could still change DNS between this check and the request — "DNS
 * rebinding" — which a production version would close by pinning the checked IP for the connection.)
 */
export async function assertPublicHttpsUrl(raw: string, { allowLocalHttp = false } = {}) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Not a valid URL');
  }
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed');
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (allowLocalHttp && local) return; // local development only
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Use an https:// address');
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dnsLookup(url.hostname, { all: true }).catch(() => {
        throw new UnsafeUrlError('That address could not be found');
      });
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('That address points to a private network');
  }
}

// --- The webhook call --------------------------------------------------------------------

const responseSchema = z.union([
  z.object({
    found: z.literal(true),
    order: z.object({
      id: z.string(),
      status: z.string().max(100),
      eta: z.string().max(100).optional(),
      items: z.array(z.string().max(200)).max(20).optional(),
      email: z.string().optional(),
    }),
  }),
  z.object({ found: z.literal(false) }),
]);

const MAX_RESPONSE_BYTES = 10_000;

export function createWebhookOrderLookup({ allowLocalHttp = false } = {}): OrderLookup {
  return {
    async lookup({ url, secret }, query) {
      await assertPublicHttpsUrl(url, { allowLocalHttp });
      const body = JSON.stringify({ type: 'order.lookup', orderId: query.orderId, email: query.email });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Support-Agent-Timestamp': timestamp,
          'X-Support-Agent-Signature': `sha256=${signWebhook(secret, timestamp, body)}`,
        },
        body,
        redirect: 'manual', // a redirect could point somewhere private; don't follow
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`order webhook answered ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('order webhook response too large');
      const parsed = responseSchema.parse(JSON.parse(text));
      if (!parsed.found) return { found: false };
      // Privacy, enforced on our side too: never reveal an order unless its email matches.
      const { email, ...order } = parsed.order;
      if (email && email.trim().toLowerCase() !== query.email.trim().toLowerCase()) return { found: false };
      return { found: true, order };
    },
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * A pretend merchant's order system, standing in for a real shop's backend. Our API (on Railway)
 * calls it over the internet exactly like it would call a real merchant: a signed POST.
 * It checks the signature and timestamp, then answers only if the email matches the order.
 */

const ORDERS = [
  { id: '1001', email: 'demo@acme.example', status: 'Shipped', eta: 'Arrives 21 Oct', items: ['Ceramic mug (x2)'] },
  { id: '1002', email: 'demo@acme.example', status: 'Processing', eta: 'Ships within 2 days', items: ['Linen tote bag'] },
  { id: '1003', email: 'priya@acme.example', status: 'Delivered', eta: 'Delivered 15 Oct', items: ['Brass lamp'] },
  { id: '1004', email: 'priya@acme.example', status: 'Cancelled', items: ['Wool scarf'] },
];

const MAX_AGE_SECONDS = 300;
const unauthorized = (reason: string) => Response.json({ error: reason }, { status: 401 });

export async function POST(request: Request) {
  const secret = process.env.DEMO_SHOP_SECRET;
  if (!secret) return Response.json({ error: 'demo shop not configured' }, { status: 404 });

  const body = await request.text();
  const timestamp = request.headers.get('x-support-agent-timestamp') ?? '';
  const signature = request.headers.get('x-support-agent-signature') ?? '';

  // Old requests are rejected so a captured request can't be replayed later.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > MAX_AGE_SECONDS) return unauthorized('stale or missing timestamp');

  // Recompute the signature with the shared secret. timingSafeEqual: the comparison takes the
  // same time whether the first or last character differs, so it can't be guessed byte by byte.
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`);
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return unauthorized('bad signature');

  const { orderId, email } = JSON.parse(body) as { orderId?: string; email?: string };
  const order = ORDERS.find((o) => o.id === String(orderId ?? '').replace(/^#/, ''));
  if (!order || order.email !== String(email ?? '').trim().toLowerCase()) return Response.json({ found: false });
  return Response.json({ found: true, order });
}

import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The widget page may only be shown inside an iframe on the websites the business allowed.
 * CSP frame-ancestors makes the *browser* enforce that: on any other site the iframe stays blank,
 * whatever that site's scripts do. Our own site ('self') may frame it, for the dashboard preview.
 * An unknown key gets 'none'.
 */
export async function proxy(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key') ?? '';
  let ancestors = "'none'";
  if (/^pk_live_[A-Za-z0-9_-]{10,64}$/.test(key)) {
    try {
      const res = await fetch(`${API_URL}/public/widget-config?key=${encodeURIComponent(key)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const { allowedOrigins } = (await res.json()) as { allowedOrigins: string[] };
        ancestors = ["'self'", ...allowedOrigins].join(' ');
      }
    } catch {
      // API unreachable: fail closed.
    }
  }
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
  return response;
}

export const config = { matcher: '/widget' };

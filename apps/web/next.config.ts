import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Local dev: also read the repo-root .env (Next only looks in apps/web by default).
// forceReload: Next has already loaded (and cached) apps/web's env, so a plain call is a no-op.
// Production builds skip this and use the host's variables (Vercel).
if (process.env.NODE_ENV !== 'production') {
  loadEnvConfig(path.resolve(process.cwd(), '../..'), true, console, true);
}

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Backend-for-frontend proxy: the browser only ever calls this site's /api/*, and Next forwards
  // it to the API. The session cookie is then first-party to this domain, so browsers that block
  // third-party cookies (vercel.app -> railway.app) don't break login, and no CORS is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;

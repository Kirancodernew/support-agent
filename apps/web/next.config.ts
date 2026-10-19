import type { NextConfig } from 'next';

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

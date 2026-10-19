import type { Request, RequestHandler } from 'express';
import { HttpError } from '../lib/http-error';
import { SESSION_COOKIE, verifySession, type Session } from './session';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: Session;
  }
}

/** Rejects the request with 401 unless it carries a valid session cookie. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const session = typeof token === 'string' ? verifySession(token) : null;
  if (!session) throw new HttpError(401, 'unauthorized', 'Please log in');
  req.auth = session;
  next();
};

/** The session set by requireAuth. Only call in routes behind it. */
export function getAuth(req: Request): Session {
  if (!req.auth) throw new HttpError(401, 'unauthorized', 'Please log in');
  return req.auth;
}

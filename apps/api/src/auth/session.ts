import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { isValidObjectId } from 'mongoose';
import { env } from '../env';

export const SESSION_COOKIE = 'sa_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type Session = { userId: string; workspaceId: string };

const cookieOptions: CookieOptions = {
  httpOnly: true, // page JavaScript can't read it, so an XSS bug can't steal the session
  secure: env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'lax', // not sent on cross-site POSTs, which blocks CSRF
  path: '/',
};

export function setSessionCookie(res: Response, session: Session) {
  const token = jwt.sign({ wid: session.workspaceId }, env.JWT_SECRET, {
    subject: session.userId,
    expiresIn: MAX_AGE_SECONDS,
    algorithm: 'HS256',
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: MAX_AGE_SECONDS * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

/** Returns the session for a valid, unexpired token signed with our secret; otherwise null. */
export function verifySession(token: string): Session | null {
  try {
    // Pinning the algorithm stops a forged token from choosing a weaker one (e.g. "none").
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload === 'string') return null;
    const { sub, wid } = payload;
    // Ids must be real ObjectIds, or later lookups would throw (500) instead of rejecting (401).
    if (typeof sub !== 'string' || typeof wid !== 'string' || !isValidObjectId(sub) || !isValidObjectId(wid)) {
      return null;
    }
    return { userId: sub, workspaceId: wid };
  } catch {
    return null;
  }
}

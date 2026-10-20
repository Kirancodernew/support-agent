import type { RequestHandler } from 'express';
import { getAuth } from '../auth/require-auth';
import { HttpError } from './http-error';

/**
 * The public demo is shared by every visitor, so anything that would change it for the next person
 * (or cost storage) is off. Chat stays on, capped; the worker resets the demo every night.
 */
export const DEMO_CHAT_LIMITS = { perSessionPerHour: 5, allVisitorsPerDay: 100 };

export const forbidInDemo =
  (what: string): RequestHandler =>
  (req, _res, next) => {
    if (getAuth(req).demo) {
      throw new HttpError(403, 'demo_read_only', `${what} is turned off in the demo. Sign up free to try it with your own documents.`);
    }
    next();
  };

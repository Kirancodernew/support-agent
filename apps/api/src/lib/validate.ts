import type { z } from '@support-agent/config';
import { HttpError } from './http-error';

/** Validates a request body against a zod schema; throws a 400 listing every invalid field. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new HttpError(400, 'validation_error', 'Please check the highlighted fields', details);
  }
  return result.data;
}

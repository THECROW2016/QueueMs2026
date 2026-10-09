import { z } from 'zod';
import { badRequest } from '../utils/errors.js';

export const id = z.coerce.number().int().positive();
export const idParam = z.object({ id });
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

const text = (max: number) => z.string().trim().min(1).max(max);
export const reasonText = text(255);
export const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/** Parses and returns typed data, or throws a 400 with field-level details. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw badRequest('The request is not valid.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

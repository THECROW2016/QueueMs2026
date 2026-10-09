import { config } from '../config.js';

const MIN = 60_000;

/** "YYYY-MM-DD" of `d` in the hospital's local time. */
export function localDateKey(d: Date = new Date()): string {
  return new Date(d.getTime() + config.HOSPITAL_UTC_OFFSET_MINUTES * MIN).toISOString().slice(0, 10);
}

/** UTC instant at which the hospital-local day `key` starts. */
export function startOfLocalDay(key: string): Date {
  return new Date(Date.parse(`${key}T00:00:00.000Z`) - config.HOSPITAL_UTC_OFFSET_MINUTES * MIN);
}

/** [start, endExclusive) in UTC for an inclusive local date range. */
export function localRange(from: string, to: string): { gte: Date; lt: Date } {
  const end = startOfLocalDay(to);
  return { gte: startOfLocalDay(from), lt: new Date(end.getTime() + 24 * 60 * MIN) };
}

export const isDateKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const seconds = (a: Date | null | undefined, b: Date | null | undefined): number | null =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000)) : null;

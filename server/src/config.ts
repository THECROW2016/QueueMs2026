import 'dotenv/config';
import { z } from 'zod';

const bool = (d: boolean) =>
  z.preprocess((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase())), z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Sessions
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: bool(false),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  CORS_ORIGIN: z.string().optional(),

  // Login protection
  LOGIN_MAX_FAILED: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  RESET_TOKEN_MINUTES: z.coerce.number().int().positive().default(60),

  // Hospital local time: minutes east of UTC (Nairobi = 180). Used for daily ticket
  // sequences and report date ranges.
  HOSPITAL_UTC_OFFSET_MINUTES: z.coerce.number().int().default(180),

  // Interactive API documentation at /api/docs. Off by default in production.
  API_DOCS: z.preprocess((v) => (v === undefined || v === '' ? undefined : ['1', 'true', 'yes'].includes(String(v).toLowerCase())), z.boolean().optional()),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(400),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(2555),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  cookieSecure: parsed.data.COOKIE_SECURE || parsed.data.NODE_ENV === 'production',
};
export type Config = typeof config;

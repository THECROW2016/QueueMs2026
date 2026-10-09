import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { resolveSession } from '../services/auth.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export const SESSION_COOKIE = 'hqms_sid';

export const cookieOptions = (maxAgeMs?: number) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax' as const,
  path: '/',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

/** Attaches req.auth when a valid session cookie is present. Never rejects by itself. */
export async function sessionLoader(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length >= 20) {
      const found = await resolveSession(token);
      if (found) req.auth = found;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export const requirePermission = (permission: string) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) return next(unauthorized());
  if (!req.auth.user.permissions.has(permission)) return next(forbidden());
  next();
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests: SameSite=Lax cookie, an Origin check,
 * and a per-session token that must be echoed in the X-CSRF-Token header.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin) {
    const allowed = config.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? [];
    let ok = allowed.includes(origin);
    if (!ok) {
      try {
        ok = new URL(origin).host === req.get('host');
      } catch {
        ok = false;
      }
    }
    if (!ok) return next(forbidden('Cross-site request blocked.'));
  }

  // Requests without a session (login, password reset, kiosk ticket issue) carry nothing to forge.
  if (!req.auth) return next();

  const header = req.get('x-csrf-token') ?? '';
  const expected = req.auth.session.csrfToken;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return next(forbidden('Missing or invalid CSRF token.'));
  next();
}

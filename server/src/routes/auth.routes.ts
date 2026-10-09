import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { SESSION_COOKIE, cookieOptions, requireAuth } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';
import type { AuthUser } from '../services/access.service.js';
import { parse } from '../validators/common.js';
import { ah } from '../utils/misc.js';
import { AppError } from '../utils/errors.js';

export const serializeAuthUser = (u: AuthUser) => ({
  id: u.id, username: u.username, fullName: u.fullName, email: u.email, isAdmin: u.isAdmin, roles: u.roles,
  permissions: [...u.permissions].sort(), departmentIds: u.departmentIds, mustChangePassword: u.mustChangePassword,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.LOGIN_RATE_LIMIT,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.')),
});

const loginBody = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  role: z.enum(['admin', 'user']).optional(),
});

const passwordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const resetBody = z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(1).max(200) });

export const authRoutes = Router();

authRoutes.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(loginBody, req.body);
  const result = await auth.login({ username: body.username, password: body.password, requireAdmin: body.role === 'admin' }, req);
  res.cookie(SESSION_COOKIE, result.token, cookieOptions(result.expiresAt.getTime() - Date.now()));
  res.json({ user: serializeAuthUser(result.user), csrfToken: result.csrfToken });
}));

authRoutes.get('/me', ah(async (req, res) => {
  if (!req.auth) return void res.json({ user: null, csrfToken: null });
  res.json({ user: serializeAuthUser(req.auth.user), csrfToken: req.auth.session.csrfToken });
}));

authRoutes.post('/logout', requireAuth, ah(async (req, res) => {
  await auth.logout(req.cookies[SESSION_COOKIE], req.auth!.user.id, req);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ ok: true });
}));

authRoutes.post('/change-password', requireAuth, ah(async (req, res) => {
  const body = parse(passwordBody, req.body);
  await auth.changePassword(req.auth!.user, req.auth!.session.id, body, req);
  res.json({ ok: true });
}));

authRoutes.post('/reset-password', loginLimiter, ah(async (req, res) => {
  const body = parse(resetBody, req.body);
  await auth.resetPasswordWithToken(body, req);
  res.json({ ok: true });
}));

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getDisplaySnapshot } from '../services/display.service.js';
import { ah } from '../utils/misc.js';

/** Unauthenticated, read-only, PII-free. Mounted before the authenticated router. */
export const publicRoutes = Router();

const displayLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } } });

publicRoutes.get('/public/display', displayLimiter, ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getDisplaySnapshot());
}));

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function requestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

/** Consistent error body: { error: { code, message, details?, requestId } } */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId: req.requestId } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR', message: 'The request is not valid.', requestId: req.requestId,
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body.', requestId: req.requestId } });
  }
  if (e.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large.', requestId: req.requestId } });
  }
  if (e.code === 'P2002') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists.', requestId: req.requestId } });
  }
  if (e.code === 'P2025') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found.', requestId: req.requestId } });
  }
  logger.error('unhandled error', { requestId: req.requestId, path: req.path, method: req.method, err: e.message, stack: (err as Error)?.stack });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: req.requestId } });
}

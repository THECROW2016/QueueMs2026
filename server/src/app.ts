import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './db.js';
import { csrfProtection, sessionLoader } from './middleware/auth.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/error.js';
import { adminRoutes } from './routes/admin.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { apiRouter } from './routes/index.js';
import { ah } from './utils/misc.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY > 0) app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
          'img-src': ["'self'", 'data:', 'https://images.unsplash.com'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      strictTransportSecurity: config.isProd,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', ah(async (_req, res) => {
    const started = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'up', latencyMs: Date.now() - started, time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down', time: new Date().toISOString() });
    }
  }));

  app.use('/api', sessionLoader, csrfProtection);
  app.use('/api/auth', authRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', apiRouter);
  app.use('/api', notFoundHandler);

  // Serve the built React app (production / Docker) with SPA fallback.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { operationsRoutes } from './operations.routes.js';

/** Everything mounted here requires a signed-in user. Each handler then enforces its own permission. */
export const apiRouter = Router();
apiRouter.use(requireAuth);
apiRouter.use(operationsRoutes);

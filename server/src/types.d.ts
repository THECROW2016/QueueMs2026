import type { AuthUser, SessionInfo } from './services/access.service.js';

declare global {
  namespace Express {
    interface Request {
      auth?: { user: AuthUser; session: SessionInfo };
      requestId?: string;
    }
  }
}

export {};

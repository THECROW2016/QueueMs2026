import type http from 'node:http';
import { parse as parseCookie } from 'node:querystring';
import { Server, type Socket } from 'socket.io';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { SESSION_COOKIE } from '../middleware/auth.js';
import { canAccessDepartment, type AuthUser } from '../services/access.service.js';
import { peekSession } from '../services/auth.service.js';
import { onOutboxCommitted } from '../services/outbox.service.js';
import { logger } from '../utils/logger.js';

interface SocketData { user: AuthUser; token: string }

const room = (departmentId: number) => `dept:${departmentId}`;

function tokenFromCookie(header: string | undefined): string | null {
  if (!header) return null;
  const jar = parseCookie(header.replace(/;\s*/g, '&'));
  const v = jar[SESSION_COOKIE];
  return typeof v === 'string' && v.length >= 20 ? decodeURIComponent(v) : null;
}

export interface Realtime {
  io: Server;
  flush: () => Promise<number>;
  stop: () => Promise<void>;
}

/**
 * Socket.IO gateway.
 *  - default namespace: authenticated staff. They must `subscribe` to each department room and the server
 *    checks the permission every time; sessions are re-checked periodically and on every subscribe.
 *  - `/display` namespace: public, receives PII-free events only.
 * The dispatcher turns committed outbox rows into events (transactional outbox pattern).
 */
export function startRealtime(server: http.Server, opts: { pollMs?: number; recheckMs?: number } = {}): Realtime {
  const allowed = config.CORS_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const io = new Server(server, {
    path: '/socket.io',
    serveClient: false,
    cors: allowed.length ? { origin: allowed, credentials: true } : undefined,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      if (allowed.includes(origin)) return cb(null, true);
      try { cb(null, new URL(origin).host === req.headers.host); } catch { cb(null, false); }
    },
  });
  const display = io.of('/display');

  io.use(async (socket, next) => {
    try {
      const token = tokenFromCookie(socket.handshake.headers.cookie);
      const found = token ? await peekSession(token) : null;
      if (!found || !token) return next(new Error('UNAUTHENTICATED'));
      (socket.data as SocketData).user = found.user;
      (socket.data as SocketData).token = token;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('AUTH_FAILED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    socket.on('subscribe', async (departmentId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const data = socket.data as SocketData;
      try {
        const live = await peekSession(data.token);
        if (!live) { reply({ ok: false, error: 'SESSION_EXPIRED' }); return void socket.disconnect(true); }
        data.user = live.user; // pick up role / assignment changes
        const id = Number(departmentId);
        if (!Number.isInteger(id) || id <= 0) return reply({ ok: false, error: 'BAD_REQUEST' });
        const ok = canAccessDepartment(live.user, id, 'queue.view') || canAccessDepartment(live.user, id, 'notifications.view');
        if (!ok) return reply({ ok: false, error: 'FORBIDDEN' });
        await socket.join(room(id));
        reply({ ok: true });
      } catch {
        reply({ ok: false, error: 'INTERNAL' });
      }
    });
    socket.on('unsubscribe', (departmentId: unknown) => { void socket.leave(room(Number(departmentId))); });
  });

  // Drop sockets whose session has ended (logout, expiry, deactivated user).
  const recheck = setInterval(async () => {
    for (const s of await io.fetchSockets()) {
      const data = s.data as SocketData;
      const live = await peekSession(data.token).catch(() => undefined);
      if (live === null) s.disconnect(true);
    }
  }, opts.recheckMs ?? 30_000);
  recheck.unref();

  /* ------------------------------- Dispatcher ------------------------------- */
  let flushing: Promise<number> | null = null;
  let again = false;

  async function drain(): Promise<number> {
    let sent = 0;
    for (;;) {
      const batch = await prisma.outboxEvent.findMany({ where: { dispatchedAt: null }, orderBy: { id: 'asc' }, take: 100 });
      if (!batch.length) return sent;
      for (const ev of batch) {
        // Claim the row; if another instance already did, skip it (at-most-once; clients refetch on reconnect).
        const claimed = await prisma.$executeRaw`UPDATE OutboxEvent SET dispatchedAt = NOW(3), attempts = attempts + 1 WHERE id = ${ev.id} AND dispatchedAt IS NULL`;
        if (!claimed) continue;
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(ev.payload) as Record<string, unknown>; } catch { /* leave empty */ }
        const msg = { eventId: ev.id, ...payload };
        switch (ev.topic) {
          case 'queue.changed':
            if (ev.departmentId) io.to(room(ev.departmentId)).emit('queue.changed', msg);
            display.emit('display.refresh', { eventId: ev.id });
            break;
          case 'notification.created':
            if (ev.departmentId) io.to(room(ev.departmentId)).emit('notification.created', msg);
            break;
          case 'display.call':
            display.emit('display.call', msg);
            break;
          case 'display.refresh':
            display.emit('display.refresh', { eventId: ev.id });
            break;
        }
        sent++;
      }
    }
  }

  const flush = (): Promise<number> => {
    if (flushing) { again = true; return flushing; }
    flushing = drain()
      .catch((err) => { logger.error('outbox dispatch failed', { err: String(err) }); return 0; })
      .finally(async () => {
        flushing = null;
        if (again) { again = false; void flush(); }
      });
    return flushing;
  };

  const off = onOutboxCommitted(() => void flush());
  const timer = setInterval(() => void flush(), opts.pollMs ?? config.OUTBOX_POLL_MS);
  timer.unref();
  const cleanup = setInterval(() => {
    void prisma.outboxEvent.deleteMany({ where: { dispatchedAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } }).catch(() => undefined);
  }, 3_600_000);
  cleanup.unref();

  return {
    io, flush,
    stop: async () => {
      off(); clearInterval(timer); clearInterval(recheck); clearInterval(cleanup);
      await new Promise<void>((r) => { void io.close(() => r()); });
    },
  };
}

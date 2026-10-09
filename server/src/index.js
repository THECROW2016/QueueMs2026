import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  HttpError,
  callNext,
  createCounter,
  createService,
  findTicketByCode,
  getTicket,
  issueTicket,
  listCounters,
  listServices,
  snapshot,
  transition,
} from './queue.js';
import {
  changePassword,
  createUser,
  ensureAdmin,
  listUsers,
  login,
  logout,
  requireRole,
  setSessionCookie,
  userFromRequest,
} from './auth.js';
import { smsEnabled } from './sms.js';

ensureAdmin();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);
// Only needed when the UI is served from another origin during development.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Wrap handlers so thrown HttpErrors become JSON responses.
const route = (fn) => (req, res) => {
  try {
    const result = fn(req, res);
    if (result !== undefined) res.json(result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message });
  }
};

const broadcast = () => io.emit('queue:update', snapshot());
const staff = requireRole('user'); // any signed-in account
const admin = requireRole('admin');

// Public views of a ticket never include the customer's phone number.
const publicTicket = ({ phone, ...t }) => ({ ...t, has_phone: Boolean(phone) });

/* ---------- Auth ---------- */

const attempts = new Map(); // ip -> { count, resetAt }
function limitLogins(req, res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip);
  if (!entry || entry.resetAt < now) attempts.set(req.ip, { count: 0, resetAt: now + 15 * 6e4 });
  if (attempts.get(req.ip).count >= 10) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  }
  next();
}

app.post('/api/auth/login', limitLogins, route((req, res) => {
  try {
    const { token, user, maxAge } = login(req.body || {});
    attempts.delete(req.ip);
    setSessionCookie(res, token, maxAge);
    return { user, redirectUrl: user.role === 'admin' && req.body.role === 'admin' ? '/admin' : '/counter' };
  } catch (err) {
    attempts.get(req.ip).count += 1;
    throw err;
  }
}));
app.post('/api/auth/logout', route((req, res) => {
  logout(req, res);
  return { ok: true };
}));
app.get('/api/auth/me', route((req) => ({ user: userFromRequest(req) })));
app.post('/api/auth/password', staff, route((req) => {
  changePassword(req.user.id, req.body || {});
  return { ok: true };
}));

app.get('/api/users', admin, route(() => listUsers()));
app.post('/api/users', admin, route((req) => createUser(req.body || {})));

/* ---------- Queue ---------- */

app.get('/api/health', route(() => ({ ok: true, sms: smsEnabled ? 'africastalking' : 'console' })));
app.get('/api/queue', route(() => snapshot()));

app.get('/api/services', route(() => listServices()));
app.post('/api/services', admin, route((req) => {
  const s = createService(req.body);
  broadcast();
  return s;
}));

app.get('/api/counters', route(() => listCounters()));
app.post('/api/counters', admin, route((req) => {
  const c = createCounter(req.body);
  broadcast();
  return c;
}));

// Ticket issuing stays public: it is used by the kiosk.
app.post('/api/tickets', route((req) => {
  const t = issueTicket(req.body);
  broadcast();
  return publicTicket(t);
}));
app.get('/api/tickets/lookup', route((req) => publicTicket(findTicketByCode(req.query.code))));
app.get('/api/tickets/:id', route((req) => publicTicket(getTicket(Number(req.params.id)))));

app.post('/api/counters/:id/call-next', staff, route((req) => {
  const t = callNext(Number(req.params.id), req.body?.serviceIds);
  if (t) io.emit('ticket:called', { code: t.code, counter: t.counter_name });
  broadcast();
  return { ticket: t && publicTicket(t) };
}));

for (const action of ['recall', 'serve', 'complete', 'skip']) {
  app.post(`/api/tickets/:id/${action}`, staff, route((req) => {
    const t = transition(Number(req.params.id), action);
    if (action === 'recall') io.emit('ticket:called', { code: t.code, counter: t.counter_name });
    broadcast();
    return publicTicket(t);
  }));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app from the same server.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

io.on('connection', (socket) => socket.emit('queue:update', snapshot()));

const port = Number(process.env.PORT || 4000);
server.listen(port, () => {
  console.log(`QueueMS server on http://localhost:${port} (sms: ${smsEnabled ? 'on' : 'console'})`);
});

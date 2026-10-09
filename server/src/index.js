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
  getTicket,
  issueTicket,
  listCounters,
  listServices,
  snapshot,
  transition,
} from './queue.js';
import { smsEnabled } from './sms.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
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

app.get('/api/health', route(() => ({ ok: true, sms: smsEnabled ? 'africastalking' : 'console' })));
app.get('/api/queue', route(() => snapshot()));

app.get('/api/services', route(() => listServices()));
app.post('/api/services', route((req) => {
  const s = createService(req.body);
  broadcast();
  return s;
}));

app.get('/api/counters', route(() => listCounters()));
app.post('/api/counters', route((req) => {
  const c = createCounter(req.body);
  broadcast();
  return c;
}));

app.post('/api/tickets', route((req) => {
  const t = issueTicket(req.body);
  broadcast();
  return t;
}));
app.get('/api/tickets/:id', route((req) => getTicket(Number(req.params.id))));

app.post('/api/counters/:id/call-next', route((req) => {
  const t = callNext(Number(req.params.id), req.body?.serviceIds);
  if (t) io.emit('ticket:called', { code: t.code, counter: t.counter_name });
  broadcast();
  return { ticket: t };
}));

for (const action of ['recall', 'serve', 'complete', 'skip']) {
  app.post(`/api/tickets/:id/${action}`, route((req) => {
    const t = transition(Number(req.params.id), action);
    if (action === 'recall') io.emit('ticket:called', { code: t.code, counter: t.counter_name });
    broadcast();
    return t;
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

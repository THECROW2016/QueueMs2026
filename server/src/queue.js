import { db } from './db.js';
import { normalizePhone, sendSms } from './sms.js';

const NOTIFY_AHEAD = Number(process.env.NOTIFY_AHEAD || 3);
const ORG_NAME = process.env.ORG_NAME || 'QueueMS';

const q = {
  services: db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY id'),
  service: db.prepare('SELECT * FROM services WHERE id = ?'),
  counters: db.prepare('SELECT * FROM counters WHERE active = 1 ORDER BY id'),
  counter: db.prepare('SELECT * FROM counters WHERE id = ?'),
  ticket: db.prepare(`
    SELECT t.*, s.name AS service_name, c.name AS counter_name
    FROM tickets t
    JOIN services s ON s.id = t.service_id
    LEFT JOIN counters c ON c.id = t.counter_id
    WHERE t.id = ?`),
  todayCount: db.prepare(`
    SELECT COUNT(*) AS n FROM tickets
    WHERE service_id = ? AND date(created_at) = date('now')`),
  insertTicket: db.prepare(`
    INSERT INTO tickets (service_id, number, code, phone) VALUES (?, ?, ?, ?)`),
  position: db.prepare(`
    SELECT COUNT(*) AS n FROM tickets
    WHERE service_id = ? AND status = 'waiting' AND id < ?`),
  activeAtCounter: db.prepare(`
    SELECT id FROM tickets WHERE counter_id = ? AND status IN ('called','serving')`),
  waitingForNotify: db.prepare(`
    SELECT * FROM tickets
    WHERE service_id = ? AND status = 'waiting' AND near_notified = 0 AND phone IS NOT NULL
    ORDER BY id LIMIT ?`),
  markNotified: db.prepare('UPDATE tickets SET near_notified = 1 WHERE id = ?'),
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const listServices = () => q.services.all();
export const listCounters = () => q.counters.all();

export function createService({ name, prefix }) {
  if (!name || !prefix) throw new HttpError(400, 'name and prefix are required');
  const p = String(prefix).trim().toUpperCase().slice(0, 3);
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO services (name, prefix) VALUES (?, ?)')
      .run(String(name).trim(), p);
    return q.service.get(lastInsertRowid);
  } catch {
    throw new HttpError(409, `Prefix "${p}" is already used`);
  }
}

export function createCounter({ name }) {
  if (!name) throw new HttpError(400, 'name is required');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO counters (name) VALUES (?)')
      .run(String(name).trim());
    return q.counter.get(lastInsertRowid);
  } catch {
    throw new HttpError(409, `Counter "${name}" already exists`);
  }
}

export function getTicket(id) {
  const t = q.ticket.get(id);
  if (!t) throw new HttpError(404, 'Ticket not found');
  const ahead = t.status === 'waiting' ? q.position.get(t.service_id, t.id).n : 0;
  return { ...t, ahead };
}

export function issueTicket({ serviceId, phone }) {
  const service = q.service.get(serviceId);
  if (!service || !service.active) throw new HttpError(404, 'Service not found');

  let normalized = null;
  if (phone) {
    normalized = normalizePhone(phone);
    if (!normalized) throw new HttpError(400, 'Phone number is not valid');
  }

  const id = db.transaction(() => {
    const number = q.todayCount.get(service.id).n + 1;
    const code = `${service.prefix}${String(number).padStart(3, '0')}`;
    return q.insertTicket.run(service.id, number, code, normalized).lastInsertRowid;
  })();

  const ticket = getTicket(id);
  if (normalized) {
    // Already near the front: the confirmation text doubles as the "near" alert.
    if (ticket.ahead < NOTIFY_AHEAD) q.markNotified.run(ticket.id);
    sendSms(
      normalized,
      `${ORG_NAME}: Your ticket is ${ticket.code} for ${ticket.service_name}. ` +
        `${ticket.ahead} ahead of you. We'll text you when your turn is near.`,
    );
  }
  return ticket;
}

/** Call the oldest waiting ticket among the given services to a counter. */
export function callNext(counterId, serviceIds) {
  const counter = q.counter.get(counterId);
  if (!counter) throw new HttpError(404, 'Counter not found');

  const ids = (Array.isArray(serviceIds) && serviceIds.length
    ? serviceIds
    : listServices().map((s) => s.id)
  ).map(Number);

  const ticketId = db.transaction(() => {
    // Finish whatever the counter was handling before taking the next one.
    for (const { id } of q.activeAtCounter.all(counterId)) {
      db.prepare(
        "UPDATE tickets SET status = 'done', completed_at = datetime('now') WHERE id = ?",
      ).run(id);
    }
    const placeholders = ids.map(() => '?').join(',');
    const next = db
      .prepare(
        `SELECT id FROM tickets WHERE status = 'waiting' AND service_id IN (${placeholders})
         ORDER BY id LIMIT 1`,
      )
      .get(...ids);
    if (!next) return null;
    db.prepare(
      "UPDATE tickets SET status = 'called', counter_id = ?, called_at = datetime('now') WHERE id = ?",
    ).run(counterId, next.id);
    return next.id;
  })();

  if (!ticketId) return null;
  const ticket = getTicket(ticketId);
  if (ticket.phone) {
    sendSms(
      ticket.phone,
      `${ORG_NAME}: Ticket ${ticket.code}, please proceed to ${ticket.counter_name} now.`,
    );
  }
  notifyNear(ticket.service_id);
  return ticket;
}

/** Text customers who are now within NOTIFY_AHEAD places of the front. */
function notifyNear(serviceId) {
  if (NOTIFY_AHEAD <= 0) return;
  for (const t of q.waitingForNotify.all(serviceId, NOTIFY_AHEAD)) {
    const ahead = q.position.get(serviceId, t.id).n;
    if (ahead >= NOTIFY_AHEAD) continue;
    q.markNotified.run(t.id);
    sendSms(
      t.phone,
      `${ORG_NAME}: Ticket ${t.code}, your turn is near (${ahead} ahead). Please be ready.`,
    );
  }
}

const transitions = {
  recall: { from: ['called'], set: "status = 'called', called_at = datetime('now')" },
  serve: { from: ['called'], set: "status = 'serving', served_at = datetime('now')" },
  complete: { from: ['called', 'serving'], set: "status = 'done', completed_at = datetime('now')" },
  skip: { from: ['called'], set: "status = 'skipped', completed_at = datetime('now')" },
};

export function transition(ticketId, action) {
  const rule = transitions[action];
  if (!rule) throw new HttpError(400, 'Unknown action');
  const t = getTicket(ticketId);
  if (!rule.from.includes(t.status)) {
    throw new HttpError(409, `Cannot ${action} a ticket that is ${t.status}`);
  }
  db.prepare(`UPDATE tickets SET ${rule.set} WHERE id = ?`).run(ticketId);
  if (action === 'skip') notifyNear(t.service_id);
  return getTicket(ticketId);
}

/** Everything the display screen and counter panels need in one payload. */
export function snapshot() {
  const services = listServices().map((s) => ({
    ...s,
    waiting: db
      .prepare("SELECT COUNT(*) AS n FROM tickets WHERE service_id = ? AND status = 'waiting'")
      .get(s.id).n,
  }));
  const counters = listCounters().map((c) => ({
    ...c,
    current:
      db
        .prepare(
          `SELECT t.id, t.code, t.status, s.name AS service_name FROM tickets t
           JOIN services s ON s.id = t.service_id
           WHERE t.counter_id = ? AND t.status IN ('called','serving')
           ORDER BY t.called_at DESC LIMIT 1`,
        )
        .get(c.id) || null,
  }));
  const recent = db
    .prepare(
      `SELECT t.id, t.code, c.name AS counter_name, t.called_at FROM tickets t
       JOIN counters c ON c.id = t.counter_id
       WHERE t.called_at IS NOT NULL AND date(t.called_at) = date('now')
       ORDER BY t.called_at DESC, t.id DESC LIMIT 8`,
    )
    .all();
  return { services, counters, recent, at: new Date().toISOString() };
}

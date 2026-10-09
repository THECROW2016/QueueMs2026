import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.resolve('data', 'queuems.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    prefix     TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS counters (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id    INTEGER NOT NULL REFERENCES services(id),
    number        INTEGER NOT NULL,
    code          TEXT NOT NULL,
    phone         TEXT,
    status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting','called','serving','done','skipped')),
    counter_id    INTEGER REFERENCES counters(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    called_at     TEXT,
    served_at     TEXT,
    completed_at  TEXT,
    near_notified INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, service_id, id);
`);

// Seed a few defaults on first run so the app is usable immediately.
const hasServices = db.prepare('SELECT COUNT(*) AS n FROM services').get().n > 0;
if (!hasServices) {
  const addService = db.prepare('INSERT INTO services (name, prefix) VALUES (?, ?)');
  addService.run('General Enquiries', 'A');
  addService.run('Payments', 'B');
  addService.run('Customer Care', 'C');
}
const hasCounters = db.prepare('SELECT COUNT(*) AS n FROM counters').get().n > 0;
if (!hasCounters) {
  const addCounter = db.prepare('INSERT INTO counters (name) VALUES (?)');
  ['Counter 1', 'Counter 2', 'Counter 3'].forEach((n) => addCounter.run(n));
}

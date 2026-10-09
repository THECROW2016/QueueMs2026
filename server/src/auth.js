import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError } from './queue.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name     TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','user')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
  );
`);

const COOKIE = 'qms_session';
const SHORT_SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// A fixed hash so failed lookups take as long as real ones.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = (u) => u && { id: u.id, username: u.username, full_name: u.full_name, role: u.role };

/** Create the first admin. Uses ADMIN_USERNAME / ADMIN_PASSWORD if set,
 *  otherwise generates a password and prints it once to the server log. */
export function ensureAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const fromEnv = Boolean(process.env.ADMIN_PASSWORD);
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare(
    "INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'admin')",
  ).run(username, 'System Administrator', hashPassword(password));
  console.log(
    fromEnv
      ? `[auth] Created admin "${username}" from ADMIN_PASSWORD.`
      : `[auth] Created admin "${username}" with password: ${password}  (change it after signing in)`,
  );
}

export function login({ username, password, role, rememberMe }) {
  if (!username || !password) throw new HttpError(400, 'Please enter your username and password.');
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .get(String(username).trim());
  const ok = verifyPassword(String(password), user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Incorrect username or password.');
  if (role === 'admin' && user.role !== 'admin') {
    throw new HttpError(403, 'This account does not have administrator access. Choose "User" to sign in.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const ms = rememberMe ? REMEMBER_DAYS * 864e5 : SHORT_SESSION_HOURS * 36e5;
  const expires = new Date(Date.now() + ms);
  db.prepare('DELETE FROM sessions WHERE expires_at < datetime(\'now\')').run();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash(token),
    user.id,
    expires.toISOString().replace('T', ' ').slice(0, 19),
  );
  return { token, user: publicUser(user), maxAge: rememberMe ? ms : undefined };
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

export function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const user = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`,
    )
    .get(tokenHash(token));
  return publicUser(user);
}

export function setSessionCookie(res, token, maxAge) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(maxAge ? { maxAge } : {}),
  });
}

export function logout(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Express middleware: require a signed-in user, optionally with a given role. */
export const requireRole = (role) => (req, res, next) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });
  if (role === 'admin' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  req.user = user;
  next();
};

export const listUsers = () =>
  db.prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY id').all();

export function createUser({ username, full_name, password, role }) {
  if (!username || !password) throw new HttpError(400, 'Username and password are required.');
  if (String(password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (!['admin', 'user'].includes(role)) throw new HttpError(400, 'Role must be admin or user.');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(String(username).trim(), full_name?.trim() || null, hashPassword(password), role);
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
  } catch {
    throw new HttpError(409, `Username "${username}" is already taken.`);
  }
}

export function changePassword(userId, { currentPassword, newPassword }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(String(currentPassword || ''), user.password_hash)) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  if (String(newPassword || '').length < 8) {
    throw new HttpError(400, 'New password must be at least 8 characters.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
}

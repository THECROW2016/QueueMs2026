import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import mariadb from 'mariadb';

const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Synthetic-Pass-1!';

/** Recreates the disposable e2e database from the committed migrations and seeds synthetic staff. */
async function prepare() {
  const url = new URL(process.env.E2E_DATABASE_URL ?? 'mysql://hqms:hqms_dev_pw@127.0.0.1:3306/hqms_e2e');
  const db = url.pathname.slice(1);
  if (!/e2e|test/i.test(db)) throw new Error(`Refusing to reset "${db}": the e2e database name must contain "e2e" or "test".`);
  const conn = await mariadb.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), multipleStatements: true });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${db}\`; CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${db}\`;`);
    const dir = path.resolve(import.meta.dirname, '../../server/prisma/migrations');
    for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
      await conn.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
    }
  } finally { await conn.end(); }

  const env = { ...process.env, DATABASE_URL: url.toString(), PRISMA_JS_ENGINE: '1', SEED_DEMO_USERS: '1', DEMO_PASSWORD: E2E_PASSWORD, ADMIN_PASSWORD: E2E_PASSWORD, NODE_ENV: 'development' };
  const server = path.resolve(import.meta.dirname, '../../server');
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { cwd: server, env, stdio: 'inherit' });
  execFileSync('npx', ['tsx', 'src/cli/create-admin.ts', '--username', 'admin', '--name', 'E2E Admin'], { cwd: server, env, stdio: 'inherit' });
}

prepare().catch((e) => { console.error(e); process.exit(1); });

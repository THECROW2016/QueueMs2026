import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

/** Recreates the disposable test database from the committed migrations. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'mysql://hqms:hqms_dev_pw@127.0.0.1:3306/hqms_test');
  const dbName = url.pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`Refusing to reset "${dbName}": the test database name must contain "test".`);

  const conn = await mariadb.createConnection({
    host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), multipleStatements: true,
  });
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\`; CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE \`${dbName}\`;`);
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
    for (const m of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
      await conn.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
    }
  } finally {
    await conn.end();
  }
}

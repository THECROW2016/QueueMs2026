import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const base = {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
};

// Normal setups use Prisma's standard schema engine (downloaded on install).
// On networks that cannot reach binaries.prisma.sh, set PRISMA_JS_ENGINE=1 to run
// `prisma generate` / `validate` with the bundled WASM engine instead. Use the
// standard engine (or the SQL files in prisma/migrations) for migrations.
export default process.env.PRISMA_JS_ENGINE === '1'
  ? defineConfig({
      ...base,
      experimental: { adapter: true },
      engine: 'js',
      async adapter() {
        return new PrismaMariaDb(process.env.DATABASE_URL ?? '');
      },
    })
  : defineConfig(base);

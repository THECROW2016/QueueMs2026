import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4100);
const DB = process.env.E2E_DATABASE_URL ?? 'mysql://hqms:hqms_dev_pw@127.0.0.1:3306/hqms_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  // The real server (API + Socket.IO + the built client) against a disposable e2e database.
  webServer: {
    // Recreate the e2e database and seed synthetic users first, then start the real server.
    command: 'npx tsx ../client/e2e/prepare-db.ts && npx tsx src/index.ts',
    cwd: '../server',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_DATABASE_URL: DB, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: DB, PRISMA_JS_ENGINE: '1', LOGIN_RATE_LIMIT: '1000' },
  },
});

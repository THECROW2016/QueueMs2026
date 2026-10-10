import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startDbWatchdog } from './db-watchdog.js';
import { startRealtime } from './sockets/index.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);

const realtime = startRealtime(server);
server.listen(config.PORT, () => logger.info('HQMS server listening', { port: config.PORT, env: config.NODE_ENV }));

const watchdog = startDbWatchdog({
  ping: () => prisma.$queryRaw`SELECT 1`,
  intervalMs: config.DB_WATCHDOG_INTERVAL_MS,
  maxFailures: config.DB_WATCHDOG_FAILURES,
  onRecovered: (n) => logger.info('database reachable again', { failedChecks: n }),
  onUnhealthy: (n, err) => {
    logger.error('database unreachable, exiting so the platform can restart the service', { failedChecks: n, err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  },
});

async function shutdown(signal: string) {
  logger.info('shutting down', { signal });
  watchdog.stop();
  await realtime.stop().catch(() => undefined);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

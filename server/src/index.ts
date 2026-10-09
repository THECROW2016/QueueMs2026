import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { startRealtime } from './sockets/index.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);

const realtime = startRealtime(server);
server.listen(config.PORT, () => logger.info('HQMS server listening', { port: config.PORT, env: config.NODE_ENV }));

async function shutdown(signal: string) {
  logger.info('shutting down', { signal });
  await realtime.stop().catch(() => undefined);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

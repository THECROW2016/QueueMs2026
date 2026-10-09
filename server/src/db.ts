import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { config } from './config.js';

// The MariaDB driver adapter talks to both MySQL 8 and MariaDB.
const adapter = new PrismaMariaDb(config.DATABASE_URL);

export const prisma = new PrismaClient({
  adapter,
  log: config.isTest ? [] : [{ emit: 'event', level: 'error' }],
});

export type Tx = Prisma.TransactionClient;

const RETRYABLE = /deadlock|lock wait timeout|write conflict|P2034|1213|1205/i;

/**
 * Runs `fn` in an interactive transaction and retries on deadlocks / lock timeouts.
 * Everything inside `fn` either commits together or not at all.
 */
export async function transact<T>(fn: (tx: Tx) => Promise<T>, attempts = 8): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : '';
      if (!RETRYABLE.test(msg) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** Math.min(i, 4) + Math.random() * 40));
    }
  }
  throw lastErr;
}

export { Prisma };

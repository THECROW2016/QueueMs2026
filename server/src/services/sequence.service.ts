import type { Tx } from '../db.js';
import { localDateKey } from '../utils/time.js';

/**
 * Allocates the next ticket number for a department, safely under concurrency.
 *
 * The sequence row is locked with SELECT ... FOR UPDATE inside the caller's transaction,
 * so concurrent creators queue up on that row and each receives a distinct number. Numbers
 * only ever increase, so cancelled tickets' numbers are never reused. The unique index on
 * (departmentId, scopeKey, ticketNumber) is a second line of defence.
 */
export async function nextTicketNumber(
  tx: Tx,
  dept: { id: number; ticketPrefix: string; sequencePolicy: 'DAILY' | 'CONTINUOUS' },
) {
  const scopeKey = dept.sequencePolicy === 'DAILY' ? localDateKey() : 'ALL';
  // Lock the existing row first; only create it when missing. (INSERT IGNORE before every SELECT ... FOR UPDATE
  // takes insert-intent locks that deadlock under load.)
  const lock = () => tx.$queryRaw<Array<{ lastNumber: number | bigint }>>`SELECT lastNumber FROM QueueSequence WHERE departmentId = ${dept.id} AND scopeKey = ${scopeKey} FOR UPDATE`;
  let rows = await lock();
  if (!rows.length) {
    await tx.$executeRaw`INSERT IGNORE INTO QueueSequence (departmentId, scopeKey, lastNumber, updatedAt) VALUES (${dept.id}, ${scopeKey}, 0, NOW(3))`;
    rows = await lock();
  }
  const ticketNumber = Number(rows[0]!.lastNumber) + 1;
  await tx.$executeRaw`UPDATE QueueSequence SET lastNumber = ${ticketNumber}, updatedAt = NOW(3) WHERE departmentId = ${dept.id} AND scopeKey = ${scopeKey}`;
  return { scopeKey, ticketNumber, displayNumber: `${dept.ticketPrefix}-${String(ticketNumber).padStart(3, '0')}` };
}

/** A generic locked counter (MRNs, visit numbers, invoice numbers) stored in SystemSetting. */
export async function nextCounter(tx: Tx, key: string): Promise<number> {
  const lock = () => tx.$queryRaw<Array<{ value: string }>>`SELECT value FROM SystemSetting WHERE \`key\` = ${key} FOR UPDATE`;
  let rows = await lock();
  if (!rows.length) {
    await tx.$executeRaw`INSERT IGNORE INTO SystemSetting (\`key\`, value, updatedAt) VALUES (${key}, '0', NOW(3))`;
    rows = await lock();
  }
  const n = Number(rows[0]!.value) + 1;
  await tx.$executeRaw`UPDATE SystemSetting SET value = ${String(n)} WHERE \`key\` = ${key}`;
  return n;
}

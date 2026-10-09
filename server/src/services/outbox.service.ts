import type { Tx } from '../db.js';
import { toJson } from '../utils/misc.js';

export type OutboxTopic =
  | 'queue.changed' // authenticated: a department queue changed (clients refetch)
  | 'notification.created' // authenticated: persistent notification for a department
  | 'display.call' // public-safe: announce a called ticket
  | 'display.refresh'; // public-safe: re-read the display snapshot

type Listener = () => void;
const listeners = new Set<Listener>();

/** The socket dispatcher subscribes so it can flush immediately after a commit. */
export const onOutboxCommitted = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const nudgeOutbox = () => listeners.forEach((l) => l());

/**
 * Writes an event row in the same transaction as the business change (transactional outbox),
 * so a committed change can never be lost and a rolled-back one is never announced.
 */
export async function enqueue(tx: Tx, topic: OutboxTopic, payload: Record<string, unknown>, departmentId?: number | null) {
  await tx.outboxEvent.create({ data: { topic, departmentId: departmentId ?? null, payload: toJson(payload) } });
}

import type { Request } from 'express';
import { prisma, type Tx } from '../db.js';
import { logger } from '../utils/logger.js';
import { clientIp, toJson } from '../utils/misc.js';

const SECRET_KEYS = /pass|token|secret|hash|csrf|cookie/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : scrub(v, depth + 1)]),
  );
}

export interface AuditInput {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: string | number;
  metadata?: Record<string, unknown>;
  req?: Request;
}

/** Writes an audit entry. Pass `tx` to make it part of a business transaction. */
export async function audit(input: AuditInput, tx?: Tx) {
  const db = tx ?? prisma;
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? input.req?.auth?.user.id ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId === undefined ? undefined : String(input.entityId),
        ipAddress: input.req ? clientIp(input.req)?.slice(0, 64) : undefined,
        userAgent: input.req?.get('user-agent')?.slice(0, 255),
        metadata: input.metadata ? toJson(scrub(input.metadata)) : undefined,
      },
    });
  } catch (err) {
    // Inside a transaction a failed audit write must abort the change.
    if (tx) throw err;
    logger.error('audit write failed', { action: input.action, err: String(err) });
  }
}

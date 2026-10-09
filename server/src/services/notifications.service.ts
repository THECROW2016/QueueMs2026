import { prisma, type Tx } from '../db.js';
import { canSeeAllDepartments, type AuthUser } from './access.service.js';
import { enqueue } from './outbox.service.js';

export interface NewNotification {
  /** Unique per logical event so a retry can never create a duplicate. */
  eventKey: string;
  departmentId: number;
  type: 'NEW_TICKET' | 'REFERRAL_RECEIVED' | 'TRANSFER_RECEIVED' | 'SERVICE_COMPLETED' | 'RESULT_AVAILABLE' | 'PATIENT_RETURNED' | 'EMERGENCY';
  title: string;
  body?: string;
  ticketId?: number;
  visitId?: number;
}

/** Creates a persistent notification (idempotent on eventKey) and queues the live event. */
export async function notify(tx: Tx, n: NewNotification) {
  const created = await tx.notification.createMany({
    data: [{ eventKey: n.eventKey, departmentId: n.departmentId, type: n.type, title: n.title, body: n.body, ticketId: n.ticketId, visitId: n.visitId }],
    skipDuplicates: true,
  });
  if (created.count === 0) return null;
  const row = await tx.notification.findUniqueOrThrow({ where: { eventKey: n.eventKey } });
  await enqueue(tx, 'notification.created', {
    notificationId: row.id, departmentId: n.departmentId, type: n.type, title: n.title, body: n.body ?? null,
    ticketId: n.ticketId ?? null, createdAt: row.createdAt.toISOString(),
  }, n.departmentId);
  return row;
}

function scopeDepartments(user: AuthUser): { departmentId?: { in: number[] } } {
  return canSeeAllDepartments(user) ? {} : { departmentId: { in: user.departmentIds } };
}

export async function listNotifications(user: AuthUser, q: { afterId?: number; unreadOnly?: boolean; page: number; pageSize: number; departmentId?: number }) {
  const where = {
    ...scopeDepartments(user),
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.afterId ? { id: { gt: q.afterId } } : {}),
    ...(q.unreadOnly ? { reads: { none: { userId: user.id } } } : {}),
  };
  // A department filter must still be one the user may see.
  if (q.departmentId && !canSeeAllDepartments(user) && !user.departmentIds.includes(q.departmentId)) {
    return { items: [], total: 0, unread: 0, page: q.page, pageSize: q.pageSize };
  }
  const [total, rows, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { reads: { where: { userId: user.id }, select: { readAt: true } }, department: { select: { name: true, code: true } } },
    }),
    prisma.notification.count({ where: { ...scopeDepartments(user), reads: { none: { userId: user.id } } } }),
  ]);
  return {
    total, unread, page: q.page, pageSize: q.pageSize,
    items: rows.map((r) => ({
      id: r.id, type: r.type, title: r.title, body: r.body, ticketId: r.ticketId, visitId: r.visitId, createdAt: r.createdAt,
      department: r.department, read: r.reads.length > 0,
    })),
  };
}

export async function markRead(user: AuthUser, input: { ids?: number[]; all?: boolean }) {
  const visible = await prisma.notification.findMany({
    where: { ...scopeDepartments(user), ...(input.all ? {} : { id: { in: input.ids ?? [] } }), reads: { none: { userId: user.id } } },
    select: { id: true },
  });
  if (visible.length) {
    await prisma.notificationRead.createMany({ data: visible.map((v) => ({ userId: user.id, notificationId: v.id })), skipDuplicates: true });
  }
  return { marked: visible.length };
}

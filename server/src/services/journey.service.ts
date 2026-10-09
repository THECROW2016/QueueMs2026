import { prisma } from '../db.js';
import { parseJson } from '../utils/misc.js';
import { seconds } from '../utils/time.js';
import { can, type AuthUser } from './access.service.js';
import { assertVisitAccess } from './visits.service.js';

export type StageStatus =
  | 'NOT_STARTED' | 'NOT_REQUIRED' | 'WAITING' | 'CALLED' | 'IN_SERVICE' | 'ON_HOLD' | 'ABSENT'
  | 'COMPLETED' | 'REFERRED' | 'SKIPPED' | 'CANCELLED';

/**
 * Builds the patient's journey: one entry per department (with every ticket the patient had
 * there) plus, for users with the full-journey permission, the chronological event timeline.
 *
 * Department with no ticket: NOT_STARTED while the visit is open (it may still be needed),
 * NOT_REQUIRED once the visit has finished without the patient ever needing it.
 */
export async function getJourney(user: AuthUser, visitId: number) {
  const visit = await assertVisitAccess(user, visitId);
  const full = can(user, 'journey.view_full');
  if (!full && !can(user, 'journey.view')) return null;

  const [depts, tickets, referrals] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.queueTicket.findMany({ where: { visitId }, orderBy: { id: 'asc' }, include: { counter: { select: { name: true } } } }),
    prisma.clinicalReferral.findMany({ where: { visitId } }),
  ]);
  const referralById = new Map(referrals.map((r) => [r.id, r]));

  const userIds = new Set<number>();
  if (full) tickets.forEach((t) => [t.calledById, t.servedById, t.createdById].forEach((u) => u && userIds.add(u)));
  const users = full ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.fullName]));

  const stages = depts.map((d) => {
    const dt = tickets.filter((t) => t.departmentId === d.id);
    let status: StageStatus;
    if (!dt.length) status = visit.status === 'ACTIVE' ? 'NOT_STARTED' : 'NOT_REQUIRED';
    else {
      // Roll up several tickets (e.g. several lab tests) into one stage status: anything still open wins.
      const open = dt.find((t) => ['IN_SERVICE', 'CALLED', 'ON_HOLD', 'WAITING', 'ABSENT'].includes(t.status));
      status = (open ?? dt[dt.length - 1]!).status as StageStatus;
    }
    return {
      department: { id: d.id, code: d.code, name: d.name },
      status,
      tickets: dt.map((t) => {
        const base = {
          id: t.id, displayNumber: t.displayNumber, status: t.status, serviceType: t.serviceType, priority: t.priority,
          enteredAt: t.enteredAt, firstCalledAt: t.firstCalledAt, serviceStartedAt: t.serviceStartedAt, completedAt: t.completedAt,
          waitSeconds: seconds(t.enteredAt, t.firstCalledAt), serviceSeconds: seconds(t.serviceStartedAt, t.completedAt),
        };
        if (!full) return base;
        const ref = t.referralId ? referralById.get(t.referralId) : null;
        return {
          ...base, workflowStage: t.workflowStage, resultStatus: t.resultStatus, counter: t.counter?.name ?? null, statusReason: t.statusReason,
          priorityReason: t.priorityReason, calledBy: t.calledById ? userName.get(t.calledById) ?? null : null,
          servedBy: t.servedById ? userName.get(t.servedById) ?? null : null,
          referral: ref ? { serviceType: ref.serviceType, status: ref.status, ...(can(user, 'referral.notes.view') ? { notes: ref.notes } : {}) } : null,
        };
      }),
    };
  });

  let timeline: unknown[] | undefined;
  if (full) {
    const events = await prisma.journeyEvent.findMany({ where: { visitId }, orderBy: { id: 'asc' }, include: { department: { select: { name: true } } } });
    const evUsers = await prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.userId).filter((x): x is number => !!x))] } }, select: { id: true, fullName: true } });
    const nm = new Map(evUsers.map((u) => [u.id, u.fullName]));
    const ticketNo = new Map(tickets.map((t) => [t.id, t.displayNumber]));
    timeline = events.map((e) => ({
      id: e.id, at: e.createdAt, type: e.eventType, department: e.department?.name ?? null, ticket: e.ticketId ? ticketNo.get(e.ticketId) ?? null : null,
      from: e.fromStatus, to: e.toStatus, reason: e.reason, by: e.userId ? nm.get(e.userId) ?? null : null,
      details: parseJson<Record<string, unknown> | null>(e.metadata, null),
    }));
  }

  return {
    visit: { id: visit.id, visitNumber: visit.visitNumber, status: visit.status, isEmergency: visit.isEmergency, openedAt: visit.openedAt, closedAt: visit.closedAt },
    view: full ? 'full' : 'summary',
    stages,
    ...(timeline ? { timeline } : {}),
  };
}

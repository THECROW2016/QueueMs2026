import { prisma } from '../db.js';
import { publicDisplaySettings } from './settings.service.js';

/**
 * The public waiting-room display. Everything returned here is visible to anyone who can reach the
 * screen, so it contains ticket numbers, department and counter names, counts and times only —
 * never patient names, IDs, phone numbers, diagnoses, visit IDs, or clinical notes.
 */
export async function getDisplaySnapshot() {
  const settings = await publicDisplaySettings();
  const [depts, active, waiting, lastEvent] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true } }),
    prisma.queueTicket.findMany({
      where: { status: { in: ['CALLED', 'IN_SERVICE'] }, lastCalledAt: { not: null } },
      orderBy: [{ lastCalledAt: 'desc' }, { id: 'desc' }],
      take: 60,
      select: { id: true, displayNumber: true, departmentId: true, status: true, callCount: true, lastCalledAt: true, counter: { select: { name: true } } },
    }),
    prisma.queueTicket.groupBy({ by: ['departmentId'], where: { status: 'WAITING' }, _count: { _all: true } }),
    prisma.outboxEvent.aggregate({ _max: { id: true } }),
  ]);
  const waitingBy = new Map(waiting.map((w) => [w.departmentId, w._count._all]));
  const nextUp = new Map<number, string[]>();
  for (const d of depts) {
    const rows = await prisma.queueTicket.findMany({
      where: { departmentId: d.id, status: 'WAITING' }, orderBy: [{ priority: 'desc' }, { enteredAt: 'asc' }, { id: 'asc' }], take: 3, select: { displayNumber: true },
    });
    nextUp.set(d.id, rows.map((r) => r.displayNumber));
  }
  const deptName = new Map(depts.map((d) => [d.id, d.name]));
  const toCall = (t: (typeof active)[number]) => ({
    ticketId: t.id, displayNumber: t.displayNumber, department: deptName.get(t.departmentId) ?? '', departmentId: t.departmentId,
    counter: t.counter?.name ?? null, calledAt: t.lastCalledAt, callKey: `${t.id}:${t.callCount}`,
  });
  const nowServing = active.map(toCall);
  return {
    generatedAt: new Date().toISOString(),
    lastEventId: lastEvent._max.id ?? 0,
    settings,
    nowServing: nowServing.slice(0, Math.max(1, settings.recentCount)),
    departments: depts.map((d) => ({
      id: d.id, code: d.code, name: d.name, waiting: waitingBy.get(d.id) ?? 0, nextUp: nextUp.get(d.id) ?? [],
      serving: nowServing.filter((c) => c.departmentId === d.id).map((c) => ({ displayNumber: c.displayNumber, counter: c.counter })),
    })),
  };
}

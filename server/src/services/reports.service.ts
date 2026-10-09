import type { Request } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest } from '../utils/errors.js';
import { average, median, toCsv } from '../utils/misc.js';
import { localDateKey, localRange, seconds, startOfLocalDay } from '../utils/time.js';
import { audit } from './audit.service.js';
import type { AuthUser } from './access.service.js';

/**
 * Metric definitions (all times in seconds, dates in hospital-local days, [from, to] inclusive):
 *  - registrations      patients created in the range.
 *  - visits opened      visits with openedAt in the range; completed / cancelled / still active by current status.
 *  - ticket cohort      tickets with enteredAt in the range (optionally one department).
 *  - wait               firstCalledAt - enteredAt, for tickets that were called at least once.
 *  - service duration   completedAt - serviceStartedAt, for COMPLETED tickets that were started.
 *  - visit turnaround   closedAt - openedAt, for COMPLETED visits opened in the range.
 *  - absent / recalled  count of ABSENT / RECALLED journey events in the range.
 *  - transferred out    tickets that ended REFERRED (sent on to another department).
 *  - referrals in       clinical referrals created in the range into the department.
 * Cancelled visits and visits flagged as test are excluded unless explicitly included.
 */
export interface ReportQuery { from: string; to: string; departmentId?: number; includeCancelled?: boolean; includeTest?: boolean }

const MAX_DAYS = 93;

function validate(q: ReportQuery) {
  const a = Date.parse(q.from), b = Date.parse(q.to);
  if (Number.isNaN(a) || Number.isNaN(b)) throw badRequest('Use dates in YYYY-MM-DD format.');
  if (b < a) throw badRequest('The end date cannot be before the start date.');
  if ((b - a) / 86_400_000 + 1 > MAX_DAYS) throw badRequest(`Choose a range of at most ${MAX_DAYS} days.`);
  return localRange(q.from, q.to);
}

function visitFilter(q: ReportQuery) {
  return { ...(q.includeCancelled ? {} : { status: { not: 'CANCELLED' as const } }), ...(q.includeTest ? {} : { isTest: false }) };
}

export async function departmentReport(q: ReportQuery) {
  const range = validate(q);
  const depts = await prisma.department.findMany({ where: { isActive: true, ...(q.departmentId ? { id: q.departmentId } : {}) }, orderBy: { sortOrder: 'asc' } });
  const tickets = await prisma.queueTicket.findMany({
    where: { enteredAt: range, departmentId: { in: depts.map((d) => d.id) }, visit: visitFilter(q) },
    select: { id: true, departmentId: true, status: true, enteredAt: true, firstCalledAt: true, serviceStartedAt: true, completedAt: true, displayNumber: true },
  });
  const events = await prisma.journeyEvent.findMany({
    where: { createdAt: range, eventType: { in: ['ABSENT', 'RECALLED'] }, departmentId: { in: depts.map((d) => d.id) }, visit: visitFilter(q) },
    select: { departmentId: true, eventType: true },
  });
  const referrals = await prisma.clinicalReferral.groupBy({
    by: ['toDepartmentId'], where: { createdAt: range, toDepartmentId: { in: depts.map((d) => d.id) }, visit: visitFilter(q) }, _count: { _all: true },
  });
  const refIn = new Map(referrals.map((r) => [r.toDepartmentId, r._count._all]));

  return depts.map((d) => {
    const t = tickets.filter((x) => x.departmentId === d.id);
    const waits = t.map((x) => seconds(x.enteredAt, x.firstCalledAt)).filter((x): x is number => x !== null);
    const services = t.filter((x) => x.status === 'COMPLETED').map((x) => seconds(x.serviceStartedAt, x.completedAt)).filter((x): x is number => x !== null);
    const count = (s: string) => t.filter((x) => x.status === s).length;
    const ev = (type: string) => events.filter((e) => e.departmentId === d.id && e.eventType === type).length;
    return {
      departmentId: d.id, department: d.name, code: d.code,
      ticketsIssued: t.length, completed: count('COMPLETED'), transferredOut: count('REFERRED'), cancelled: count('CANCELLED'), skipped: count('SKIPPED'),
      stillOpen: t.filter((x) => ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'].includes(x.status)).length,
      absentEvents: ev('ABSENT'), recalls: ev('RECALLED'), referralsIn: refIn.get(d.id) ?? 0,
      avgWaitSeconds: average(waits), medianWaitSeconds: median(waits), longestWaitSeconds: waits.length ? Math.max(...waits) : null,
      avgServiceSeconds: average(services), medianServiceSeconds: median(services),
    };
  });
}

export async function dailyReport(q: ReportQuery) {
  const range = validate(q);
  const [patients, visits] = await Promise.all([
    prisma.patient.findMany({ where: { createdAt: range }, select: { createdAt: true } }),
    prisma.visit.findMany({ where: { openedAt: range, ...visitFilter(q) }, select: { openedAt: true, status: true, closedAt: true } }),
  ]);
  const days: Record<string, { date: string; registrations: number; visitsOpened: number; visitsCompleted: number; visitsCancelled: number; visitsActive: number }> = {};
  for (let t = startOfLocalDay(q.from).getTime(); t < range.lt.getTime(); t += 86_400_000) {
    const date = localDateKey(new Date(t));
    days[date] = { date, registrations: 0, visitsOpened: 0, visitsCompleted: 0, visitsCancelled: 0, visitsActive: 0 };
  }
  for (const p of patients) { const d = days[localDateKey(p.createdAt)]; if (d) d.registrations++; }
  for (const v of visits) {
    const d = days[localDateKey(v.openedAt)];
    if (!d) continue;
    d.visitsOpened++;
    if (v.status === 'COMPLETED') d.visitsCompleted++; else if (v.status === 'CANCELLED') d.visitsCancelled++; else d.visitsActive++;
  }
  return Object.values(days);
}

export async function summaryReport(q: ReportQuery) {
  const range = validate(q);
  const [daily, departments, visits, longest] = await Promise.all([
    dailyReport(q), departmentReport(q),
    prisma.visit.findMany({ where: { openedAt: range, ...visitFilter(q) }, select: { status: true, openedAt: true, closedAt: true } }),
    prisma.queueTicket.findMany({
      where: { enteredAt: range, firstCalledAt: { not: null }, ...(q.departmentId ? { departmentId: q.departmentId } : {}), visit: visitFilter(q) },
      select: { displayNumber: true, enteredAt: true, firstCalledAt: true, department: { select: { name: true } } }, orderBy: { enteredAt: 'asc' }, take: 5000,
    }),
  ]);
  const turnaround = visits.filter((v) => v.status === 'COMPLETED').map((v) => seconds(v.openedAt, v.closedAt)).filter((x): x is number => x !== null);
  return {
    range: { from: q.from, to: q.to, timezoneOffsetMinutes: config.HOSPITAL_UTC_OFFSET_MINUTES },
    totals: {
      registrations: daily.reduce((a, d) => a + d.registrations, 0),
      visitsOpened: visits.length,
      visitsCompleted: visits.filter((v) => v.status === 'COMPLETED').length,
      visitsIncomplete: visits.filter((v) => v.status === 'ACTIVE').length,
      visitsCancelled: visits.filter((v) => v.status === 'CANCELLED').length,
      avgVisitTurnaroundSeconds: average(turnaround), medianVisitTurnaroundSeconds: median(turnaround),
    },
    daily, departments,
    longestWaits: longest
      .map((t) => ({ ticket: t.displayNumber, department: t.department.name, waitSeconds: seconds(t.enteredAt, t.firstCalledAt)!, enteredAt: t.enteredAt }))
      .sort((a, b) => b.waitSeconds - a.waitSeconds).slice(0, 10),
  };
}

export type ExportKind = 'departments' | 'daily' | 'longest-waits';

export async function exportReportCsv(user: AuthUser, kind: ExportKind, q: ReportQuery, req?: Request) {
  let csv: string;
  if (kind === 'daily') {
    const rows = await dailyReport(q);
    csv = toCsv(['Date', 'Registrations', 'Visits opened', 'Visits completed', 'Visits cancelled', 'Visits still active'],
      rows.map((r) => [r.date, r.registrations, r.visitsOpened, r.visitsCompleted, r.visitsCancelled, r.visitsActive]));
  } else if (kind === 'longest-waits') {
    const s = await summaryReport(q);
    csv = toCsv(['Ticket', 'Department', 'Entered at', 'Wait (seconds)'], s.longestWaits.map((w) => [w.ticket, w.department, w.enteredAt.toISOString(), w.waitSeconds]));
  } else {
    const rows = await departmentReport(q);
    csv = toCsv(
      ['Department', 'Tickets issued', 'Completed', 'Transferred out', 'Cancelled', 'Skipped', 'Still open', 'Absent events', 'Recalls', 'Referrals in', 'Avg wait (s)', 'Median wait (s)', 'Longest wait (s)', 'Avg service (s)', 'Median service (s)'],
      rows.map((r) => [r.department, r.ticketsIssued, r.completed, r.transferredOut, r.cancelled, r.skipped, r.stillOpen, r.absentEvents, r.recalls, r.referralsIn, r.avgWaitSeconds, r.medianWaitSeconds, r.longestWaitSeconds, r.avgServiceSeconds, r.medianServiceSeconds]),
    );
  }
  // Exports leave the system, so they are audited. The file holds aggregates only — no patient identifiers.
  await audit({ userId: user.id, action: 'REPORT_EXPORTED', entityType: 'Report', entityId: kind, metadata: { from: q.from, to: q.to, departmentId: q.departmentId ?? null }, req });
  return csv;
}

/** Live numbers for the administrator dashboard: computed from the database on every call. */
export async function liveDashboard() {
  const today = localDateKey();
  const range = localRange(today, today);
  const [depts, open, active, regs, opened, completed, waitedToday, byStatus] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, code: true } }),
    prisma.queueTicket.findMany({ where: { status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] }, visit: { isTest: false } }, select: { departmentId: true, status: true, enteredAt: true } }),
    prisma.visit.count({ where: { status: 'ACTIVE', isTest: false } }),
    prisma.patient.count({ where: { createdAt: range } }),
    prisma.visit.count({ where: { openedAt: range, status: { not: 'CANCELLED' }, isTest: false } }),
    prisma.visit.count({ where: { closedAt: range, status: 'COMPLETED', isTest: false } }),
    prisma.queueTicket.findMany({ where: { enteredAt: range, firstCalledAt: { not: null }, visit: { isTest: false } }, select: { enteredAt: true, firstCalledAt: true } }),
    prisma.queueTicket.groupBy({ by: ['status'], where: { enteredAt: range, visit: { isTest: false } }, _count: { _all: true } }),
  ]);
  const now = Date.now();
  const waits = waitedToday.map((t) => seconds(t.enteredAt, t.firstCalledAt)).filter((x): x is number => x !== null);
  return {
    date: today,
    activeVisits: active, registrationsToday: regs, visitsOpenedToday: opened, visitsCompletedToday: completed,
    avgWaitTodaySeconds: average(waits), medianWaitTodaySeconds: median(waits),
    ticketsTodayByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    departments: depts.map((d) => {
      const rows = open.filter((t) => t.departmentId === d.id);
      const waiting = rows.filter((t) => t.status === 'WAITING');
      return {
        id: d.id, name: d.name, code: d.code,
        waiting: waiting.length, called: rows.filter((t) => t.status === 'CALLED').length, inService: rows.filter((t) => t.status === 'IN_SERVICE').length,
        onHold: rows.filter((t) => t.status === 'ON_HOLD').length, absent: rows.filter((t) => t.status === 'ABSENT').length,
        longestWaitingSeconds: waiting.length ? Math.round((now - Math.min(...waiting.map((t) => t.enteredAt.getTime()))) / 1000) : null,
      };
    }),
  };
}

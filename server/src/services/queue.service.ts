import type { Request } from 'express';
import type { Department, QueueTicket, ServiceCounter, TicketStatus, Visit } from '@prisma/client';
import { prisma, transact, type Tx } from '../db.js';
import { PRIORITY, TICKET_ACTIVE } from '../domain/constants.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { parseJson, toJson } from '../utils/misc.js';
import { localDateKey, seconds, startOfLocalDay } from '../utils/time.js';
import { audit } from './audit.service.js';
import {
  assertDepartmentPermission, can, canAccessDepartment, type AuthUser,
} from './access.service.js';
import { notify } from './notifications.service.js';
import { enqueue, nudgeOutbox } from './outbox.service.js';
import { patientCard } from './patients.service.js';
import { nextTicketNumber } from './sequence.service.js';
import { getSetting } from './settings.service.js';

/** Departments to which an authorised emergency may be routed even without a routing rule. */
const EMERGENCY_TARGET_CODES = ['CONSULTATION'];

/* ------------------------------------------------------------------------ */
/* State machine                                                              */
/* ------------------------------------------------------------------------ */

export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  WAITING: ['CALLED', 'SKIPPED', 'CANCELLED', 'REFERRED'],
  CALLED: ['CALLED', 'IN_SERVICE', 'ABSENT', 'SKIPPED', 'CANCELLED', 'REFERRED'],
  IN_SERVICE: ['ON_HOLD', 'COMPLETED', 'REFERRED', 'CANCELLED'],
  ON_HOLD: ['IN_SERVICE', 'COMPLETED', 'REFERRED', 'CANCELLED'],
  ABSENT: ['WAITING', 'SKIPPED', 'CANCELLED'],
  COMPLETED: [],
  REFERRED: [],
  SKIPPED: [],
  CANCELLED: [],
};

type FullTicket = QueueTicket & { department: Department; visit: Visit; counter: ServiceCounter | null };

async function lockTicket(tx: Tx, id: number): Promise<FullTicket> {
  await tx.$queryRaw`SELECT id FROM QueueTicket WHERE id = ${id} FOR UPDATE`;
  const t = await tx.queueTicket.findUnique({ where: { id }, include: { department: true, visit: true, counter: true } });
  if (!t) throw notFound('Ticket');
  return t;
}

function assertTransition(t: Pick<QueueTicket, 'status'>, to: TicketStatus) {
  if (!TRANSITIONS[t.status].includes(to)) {
    throw conflict(`This ticket is ${t.status.toLowerCase().replace('_', ' ')} and cannot be changed to ${to.toLowerCase().replace('_', ' ')}.`, 'INVALID_TRANSITION', { from: t.status, to });
  }
}

interface ApplyOptions {
  eventType: string;
  reason?: string | null;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** The single place where a ticket's status changes. Validates, updates, and writes the history + outbox. */
async function applyStatus(tx: Tx, t: FullTicket, to: TicketStatus, user: AuthUser, o: ApplyOptions) {
  assertTransition(t, to);
  const res = await tx.queueTicket.updateMany({
    where: { id: t.id, status: t.status, version: t.version },
    data: { status: to, version: { increment: 1 }, statusReason: o.reason ?? null, ...(o.data ?? {}) } as never,
  });
  if (res.count !== 1) throw conflict('This ticket was just changed by someone else. Refresh and try again.', 'CONCURRENT_UPDATE');
  await tx.journeyEvent.create({
    data: {
      visitId: t.visitId, ticketId: t.id, departmentId: t.departmentId, eventType: o.eventType, fromStatus: t.status, toStatus: to,
      userId: user.id, reason: o.reason ?? null, metadata: o.metadata ? toJson(o.metadata) : undefined,
    },
  });
  await enqueue(tx, 'queue.changed', { departmentId: t.departmentId, ticketId: t.id, displayNumber: t.displayNumber, status: to, eventType: o.eventType }, t.departmentId);
  if (t.status === 'CALLED' || to === 'CALLED') await enqueue(tx, 'display.refresh', {});
}

async function announce(tx: Tx, t: FullTicket, counterName: string | null, callCount: number, calledAt: Date) {
  await enqueue(tx, 'display.call', {
    ticketId: t.id, displayNumber: t.displayNumber, departmentName: t.department.name, counterName, calledAt: calledAt.toISOString(),
    callKey: `${t.id}:${callCount}`,
  });
}

/** Cancels every open ticket of a visit (used when a visit is cancelled). */
export async function cancelAllForVisit(tx: Tx, visitId: number, user: AuthUser, reason: string) {
  const open = await tx.queueTicket.findMany({ where: { visitId, status: { in: TICKET_ACTIVE as TicketStatus[] } }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const { id } of open) {
    const t = await lockTicket(tx, id);
    if (TRANSITIONS[t.status].includes('CANCELLED')) {
      await applyStatus(tx, t, 'CANCELLED', user, { eventType: 'CANCELLED', reason, data: { completedAt: new Date() } });
    }
  }
  return open.length;
}

async function afterCommit<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  nudgeOutbox();
  return r;
}

const need = (reason: string | null | undefined, what: string) => {
  const r = reason?.trim();
  if (!r) throw badRequest(`A reason is required to ${what}.`);
  return r.slice(0, 255);
};

/* ------------------------------------------------------------------------ */
/* Ticket creation (used by visits and by routing)                            */
/* ------------------------------------------------------------------------ */

export interface InsertTicketInput {
  visitId: number;
  department: Pick<Department, 'id' | 'ticketPrefix' | 'sequencePolicy' | 'name'>;
  priority?: number;
  priorityReason?: string | null;
  serviceType?: string | null;
  referralId?: number | null;
  parentTicketId?: number | null;
  createdById: number;
  eventType?: string;
  reason?: string | null;
  idempotencyKey?: string | null;
}

export async function insertTicket(tx: Tx, i: InsertTicketInput) {
  const seq = await nextTicketNumber(tx, i.department);
  const ticket = await tx.queueTicket.create({
    data: {
      visitId: i.visitId, departmentId: i.department.id, scopeKey: seq.scopeKey, ticketNumber: seq.ticketNumber, displayNumber: seq.displayNumber,
      priority: i.priority ?? 0, priorityReason: i.priorityReason ?? null, serviceType: i.serviceType ?? null,
      referralId: i.referralId ?? null, parentTicketId: i.parentTicketId ?? null, createdById: i.createdById, idempotencyKey: i.idempotencyKey ?? null,
    },
  });
  await tx.journeyEvent.create({
    data: {
      visitId: i.visitId, ticketId: ticket.id, departmentId: i.department.id, eventType: i.eventType ?? 'TICKET_CREATED',
      toStatus: 'WAITING', userId: i.createdById, reason: i.reason ?? null,
      metadata: toJson({ displayNumber: ticket.displayNumber, serviceType: i.serviceType ?? null, priority: i.priority ?? 0 }),
    },
  });
  await enqueue(tx, 'queue.changed', { departmentId: i.department.id, ticketId: ticket.id, displayNumber: ticket.displayNumber, status: 'WAITING', eventType: 'TICKET_CREATED' }, i.department.id);
  return ticket;
}

/* ------------------------------------------------------------------------ */
/* Routing: completing / transferring creates the next tickets                */
/* ------------------------------------------------------------------------ */

export interface NextStep {
  departmentId: number;
  serviceType?: string | null;
  priority?: number;
  reason?: string | null;
  notes?: string | null;
  emergency?: boolean;
}

async function routeTickets(tx: Tx, source: FullTicket, steps: NextStep[], user: AuthUser, kind: 'COMPLETE' | 'TRANSFER') {
  if (!steps.length) return [];
  const seen = new Set<string>();
  const created: Array<{ id: number; displayNumber: string; departmentId: number }> = [];

  for (const step of steps) {
    const key = `${step.departmentId}:${step.serviceType ?? ''}`;
    if (seen.has(key)) throw badRequest('The same department and service was listed twice.');
    seen.add(key);

    const target = await tx.department.findUnique({ where: { id: step.departmentId } });
    if (!target || !target.isActive) throw badRequest('Destination department does not exist or is inactive.');
    if (target.id === source.departmentId) throw badRequest('Choose a different department.');

    const emergency = !!step.emergency || step.priority === PRIORITY.EMERGENCY;
    const rule = await tx.routingRule.findUnique({
      where: { fromDepartmentId_toDepartmentId: { fromDepartmentId: source.departmentId, toDepartmentId: target.id } },
    });
    const ruleOk = !!rule && rule.isActive;
    let reason = step.reason?.trim() || null;

    if (emergency) {
      if (!can(user, 'queue.emergency')) throw forbidden('Only authorised clinical staff can use the emergency pathway.');
      if (!ruleOk && !EMERGENCY_TARGET_CODES.includes(target.code)) {
        throw conflict(`Emergency routing to ${target.name} is not permitted.`, 'ROUTE_NOT_ALLOWED');
      }
      reason = need(reason, 'route a patient through the emergency pathway');
    } else {
      if (!ruleOk || rule!.emergencyOnly) throw conflict(`Routing from ${source.department.name} to ${target.name} is not permitted.`, 'ROUTE_NOT_ALLOWED');
      if (rule!.requiresReason || kind === 'TRANSFER') reason = need(reason, 'send the patient to this department');
    }

    let priority = step.priority ?? (source.visit.isEmergency ? PRIORITY.EMERGENCY : PRIORITY.ROUTINE);
    if (emergency) priority = PRIORITY.EMERGENCY;
    if (![0, 1, 2].includes(priority)) throw badRequest('Priority must be 0, 1 or 2.');
    if (priority > 0 && !source.visit.isEmergency && !can(user, 'queue.priority')) throw forbidden('Only clinical staff can set ticket priority.');
    if (priority === PRIORITY.URGENT && !reason) reason = need(step.reason, 'mark a ticket urgent');

    const serviceTypes = parseJson<string[]>(target.serviceTypes, []);
    if (step.serviceType) {
      if (serviceTypes.length && !serviceTypes.includes(step.serviceType)) throw badRequest(`"${step.serviceType}" is not a service offered by ${target.name}.`);
    }

    const duplicate = await tx.queueTicket.findFirst({
      where: { visitId: source.visitId, departmentId: target.id, serviceType: step.serviceType ?? null, status: { in: TICKET_ACTIVE as TicketStatus[] } },
      select: { displayNumber: true },
    });
    if (duplicate) throw conflict(`This patient already has an open ${target.name} ticket (${duplicate.displayNumber}).`, 'DUPLICATE_REFERRAL');

    let referralId: number | null = null;
    if (source.department.isClinical) {
      if (!can(user, 'referral.create')) throw forbidden('You are not authorised to create clinical referrals.');
      const ref = await tx.clinicalReferral.create({
        data: {
          visitId: source.visitId, fromTicketId: source.id, fromDepartmentId: source.departmentId, toDepartmentId: target.id,
          serviceType: step.serviceType ?? null, priority, notes: step.notes?.trim() || null, createdById: user.id,
        },
      });
      referralId = ref.id;
    } else if (step.notes) {
      throw badRequest('Clinical notes can only be attached by clinical departments.');
    }

    const ticket = await insertTicket(tx, {
      visitId: source.visitId, department: target, priority, priorityReason: priority > 0 ? reason : null, serviceType: step.serviceType,
      referralId, parentTicketId: source.id, createdById: user.id, eventType: kind === 'TRANSFER' ? 'TRANSFER_CREATED' : 'ROUTED', reason,
    });

    if (emergency) {
      if (!source.visit.isEmergency) await tx.visit.update({ where: { id: source.visitId }, data: { isEmergency: true } });
      await tx.journeyEvent.create({
        data: { visitId: source.visitId, ticketId: ticket.id, departmentId: target.id, eventType: 'EMERGENCY_ROUTED', userId: user.id, reason },
      });
      await audit({ userId: user.id, action: 'EMERGENCY_ROUTED', entityType: 'QueueTicket', entityId: ticket.id, metadata: { from: source.department.code, to: target.code, reason } }, tx);
    }

    await notify(tx, {
      eventKey: `ticket-created:${ticket.id}`, departmentId: target.id,
      type: emergency ? 'EMERGENCY' : kind === 'TRANSFER' ? 'TRANSFER_RECEIVED' : referralId ? 'REFERRAL_RECEIVED' : 'NEW_TICKET',
      title: `${emergency ? 'EMERGENCY: ' : ''}${ticket.displayNumber} arrived from ${source.department.name}`,
      body: step.serviceType ? `Service: ${step.serviceType}` : undefined, ticketId: ticket.id, visitId: source.visitId,
    });
    // Returning to the department that referred the patient earlier.
    created.push({ id: ticket.id, displayNumber: ticket.displayNumber, departmentId: target.id });
  }
  return created;
}

/* ------------------------------------------------------------------------ */
/* Operations                                                                 */
/* ------------------------------------------------------------------------ */

export async function callNext(user: AuthUser, input: { departmentId: number; counterId: number }) {
  assertDepartmentPermission(user, input.departmentId, 'queue.call');
  const ordering = await getSetting<string>('queue.priorityOrdering');

  const ticketId = await afterCommit(transact(async (tx) => {
    // Lock the counter row BEFORE any plain read: InnoDB fixes its REPEATABLE READ snapshot at the first
    // non-locking read, and the busy check below must see tickets committed by callers who held the lock before us.
    await tx.$queryRaw`SELECT id FROM ServiceCounter WHERE id = ${input.counterId} FOR UPDATE`;
    const counter = await tx.serviceCounter.findUnique({ where: { id: input.counterId } });
    if (!counter || counter.departmentId !== input.departmentId || !counter.isActive) {
      throw badRequest('That counter does not belong to this department or is inactive.');
    }
    const busy = await tx.queueTicket.findFirst({ where: { counterId: counter.id, status: { in: ['CALLED', 'IN_SERVICE'] } }, select: { displayNumber: true } });
    if (busy) throw conflict(`${counter.name} is still handling ${busy.displayNumber}. Complete it, hold it or mark the patient absent first.`, 'COUNTER_BUSY');

    // Pick candidates in queue order WITHOUT locking (with ORDER BY the engine would lock every waiting row before
    // applying LIMIT), then claim the first one we can lock by primary key. SKIP LOCKED means two staff members
    // calling at once claim different tickets, never the same one.
    const candidates = ordering === 'arrival_only'
      ? await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM QueueTicket WHERE departmentId = ${input.departmentId} AND status = 'WAITING' ORDER BY enteredAt ASC, id ASC LIMIT 25`
      : await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM QueueTicket WHERE departmentId = ${input.departmentId} AND status = 'WAITING' ORDER BY priority DESC, enteredAt ASC, id ASC LIMIT 25`;
    let claimed: number | null = null;
    for (const c of candidates) {
      const got = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM QueueTicket WHERE id = ${Number(c.id)} AND status = 'WAITING' FOR UPDATE SKIP LOCKED`;
      if (got.length) { claimed = Number(got[0]!.id); break; }
    }
    if (claimed === null) return null;
    const rows = [{ id: claimed }];

    const t = await lockTicket(tx, Number(rows[0]!.id));
    const now = new Date();
    await applyStatus(tx, t, 'CALLED', user, {
      eventType: 'CALLED',
      data: { counterId: counter.id, calledById: user.id, firstCalledAt: t.firstCalledAt ?? now, lastCalledAt: now, callCount: { increment: 1 } },
      metadata: { counter: counter.name },
    });
    await announce(tx, t, counter.name, t.callCount + 1, now);
    return t.id;
  }));

  return ticketId ? getTicketView(user, ticketId) : null;
}

export async function recall(user: AuthUser, ticketId: number) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'queue.call');
    if (t.status !== 'CALLED') throw conflict(`Only a called ticket can be recalled; this one is ${t.status.toLowerCase().replace('_', ' ')}.`, 'INVALID_TRANSITION', { from: t.status, to: 'CALLED' });
    const now = new Date();
    await applyStatus(tx, t, 'CALLED', user, {
      eventType: 'RECALLED', data: { lastCalledAt: now, callCount: { increment: 1 } }, metadata: { callCount: t.callCount + 1 },
    });
    await announce(tx, t, t.counter?.name ?? null, t.callCount + 1, now);
  }));
  return getTicketView(user, ticketId);
}

async function simple(
  user: AuthUser, ticketId: number, perm: string, to: TicketStatus,
  build: (t: FullTicket, tx: Tx) => Promise<ApplyOptions> | ApplyOptions,
) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, perm);
    await applyStatus(tx, t, to, user, await build(t, tx));
  }));
  return getTicketView(user, ticketId);
}

export const startService = (user: AuthUser, id: number) =>
  simple(user, id, 'queue.serve', 'IN_SERVICE', () => ({ eventType: 'SERVICE_STARTED', data: { serviceStartedAt: new Date(), servedById: user.id } }));

export const hold = (user: AuthUser, id: number, reason?: string | null) =>
  simple(user, id, 'queue.serve', 'ON_HOLD', () => ({ eventType: 'HELD', reason: reason?.trim() || null }));

export const resume = (user: AuthUser, id: number) =>
  simple(user, id, 'queue.serve', 'IN_SERVICE', async (t, tx) => {
    if (t.counterId) {
      const other = await tx.queueTicket.findFirst({ where: { counterId: t.counterId, id: { not: t.id }, status: { in: ['CALLED', 'IN_SERVICE'] } }, select: { displayNumber: true } });
      if (other) throw conflict(`The counter is now handling ${other.displayNumber}. Finish it before resuming this ticket.`, 'COUNTER_BUSY');
    }
    return { eventType: 'RESUMED' };
  });

export const markAbsent = (user: AuthUser, id: number, reason?: string | null) =>
  simple(user, id, 'queue.absent', 'ABSENT', () => ({ eventType: 'ABSENT', reason: reason?.trim() || null, data: { counterId: null } }));

export async function restoreAbsent(user: AuthUser, id: number) {
  const grace = await getSetting<number>('queue.absentGraceMinutes');
  return simple(user, id, 'queue.absent', 'WAITING', async (t, tx) => {
    const lastAbsent = await tx.journeyEvent.findFirst({ where: { ticketId: t.id, eventType: 'ABSENT' }, orderBy: { id: 'desc' } });
    const minutes = lastAbsent ? (Date.now() - lastAbsent.createdAt.getTime()) / 60_000 : 0;
    if (minutes > grace) {
      throw conflict(`This patient has been absent for more than ${grace} minutes and can no longer be restored. Cancel the ticket or issue a new one.`, 'ABSENT_EXPIRED');
    }
    await audit({ userId: user.id, action: 'TICKET_RESTORED', entityType: 'QueueTicket', entityId: t.id }, tx);
    return { eventType: 'RESTORED', data: { counterId: null } };
  });
}

export const skip = (user: AuthUser, id: number, reason: string | null | undefined) =>
  simple(user, id, 'queue.skip', 'SKIPPED', async (t, tx) => {
    const r = need(reason, 'skip a ticket');
    await audit({ userId: user.id, action: 'TICKET_SKIPPED', entityType: 'QueueTicket', entityId: t.id, metadata: { reason: r } }, tx);
    return { eventType: 'SKIPPED', reason: r, data: { completedAt: new Date() } };
  });

export const cancel = (user: AuthUser, id: number, reason: string | null | undefined) =>
  simple(user, id, 'queue.cancel', 'CANCELLED', async (t, tx) => {
    const r = need(reason, 'cancel a ticket');
    await audit({ userId: user.id, action: 'TICKET_CANCELLED', entityType: 'QueueTicket', entityId: t.id, metadata: { reason: r } }, tx);
    return { eventType: 'CANCELLED', reason: r, data: { completedAt: new Date() } };
  });

export async function complete(user: AuthUser, ticketId: number, input: { next?: NextStep[]; note?: string | null } = {}) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'queue.complete');
    await applyStatus(tx, t, 'COMPLETED', user, {
      eventType: 'COMPLETED', data: { completedAt: new Date() }, metadata: input.next?.length ? { next: input.next.map((n) => n.departmentId) } : undefined,
    });
    const routed = await routeTickets(tx, t, input.next ?? [], user, 'COMPLETE');
    if (routed.length === 0 && t.referralId) {
      // Service finished for a referred patient: close the referral and tell the referring department.
      const ref = await tx.clinicalReferral.update({ where: { id: t.referralId }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await notify(tx, {
        eventKey: `service-completed:${t.id}`, departmentId: ref.fromDepartmentId, type: 'SERVICE_COMPLETED',
        title: `${t.displayNumber} completed at ${t.department.name}`, ticketId: t.id, visitId: t.visitId,
      });
    } else if (t.referralId) {
      await tx.clinicalReferral.update({ where: { id: t.referralId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    }
  }));
  return getTicketView(user, ticketId);
}

export async function transfer(user: AuthUser, ticketId: number, step: NextStep) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'queue.transfer');
    const reason = need(step.reason, 'transfer a ticket');
    await applyStatus(tx, t, 'REFERRED', user, {
      eventType: 'TRANSFERRED', reason, data: { completedAt: new Date(), counterId: t.counterId }, metadata: { to: step.departmentId },
    });
    await routeTickets(tx, t, [{ ...step, reason }], user, 'TRANSFER');
    await audit({ userId: user.id, action: 'TICKET_TRANSFERRED', entityType: 'QueueTicket', entityId: t.id, metadata: { to: step.departmentId, reason } }, tx);
  }));
  return getTicketView(user, ticketId);
}

export async function setPriority(user: AuthUser, ticketId: number, input: { priority: number; reason?: string | null }) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'queue.priority');
    if (input.priority === PRIORITY.EMERGENCY && !can(user, 'queue.emergency')) throw forbidden('Only authorised clinical staff can mark a ticket as emergency.');
    if (!['WAITING', 'CALLED', 'ABSENT', 'ON_HOLD', 'IN_SERVICE'].includes(t.status)) throw conflict('This ticket is closed.', 'INVALID_TRANSITION');
    const reason = need(input.reason, 'change ticket priority');
    await tx.queueTicket.update({ where: { id: t.id }, data: { priority: input.priority, priorityReason: input.priority ? reason : null, version: { increment: 1 } } });
    await tx.journeyEvent.create({ data: { visitId: t.visitId, ticketId: t.id, departmentId: t.departmentId, eventType: 'PRIORITY_CHANGED', userId: user.id, reason, metadata: toJson({ from: t.priority, to: input.priority }) } });
    if (input.priority === PRIORITY.EMERGENCY && !t.visit.isEmergency) await tx.visit.update({ where: { id: t.visitId }, data: { isEmergency: true } });
    await audit({ userId: user.id, action: 'TICKET_PRIORITY_CHANGED', entityType: 'QueueTicket', entityId: t.id, metadata: { from: t.priority, to: input.priority, reason } }, tx);
    await enqueue(tx, 'queue.changed', { departmentId: t.departmentId, ticketId: t.id, displayNumber: t.displayNumber, status: t.status, eventType: 'PRIORITY_CHANGED' }, t.departmentId);
  }));
  return getTicketView(user, ticketId);
}

export async function setWorkflowStage(user: AuthUser, ticketId: number, stage: string) {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'queue.serve');
    const stages = parseJson<string[]>(t.department.workflowStages, []);
    if (!stages.includes(stage)) throw badRequest(`"${stage}" is not a workflow stage of ${t.department.name}.`);
    if (!['CALLED', 'IN_SERVICE', 'ON_HOLD'].includes(t.status)) throw conflict('The workflow stage can only be changed while the patient is being served.', 'INVALID_TRANSITION');
    if (stage === 'URGENT_ASSESSMENT' && !can(user, 'queue.priority')) throw forbidden('Only authorised clinical staff can mark urgent assessment.');
    await tx.queueTicket.update({ where: { id: t.id }, data: { workflowStage: stage, version: { increment: 1 } } });
    await tx.journeyEvent.create({ data: { visitId: t.visitId, ticketId: t.id, departmentId: t.departmentId, eventType: 'WORKFLOW_STAGE', userId: user.id, metadata: toJson({ from: t.workflowStage, to: stage }) } });
    await enqueue(tx, 'queue.changed', { departmentId: t.departmentId, ticketId: t.id, displayNumber: t.displayNumber, status: t.status, eventType: 'WORKFLOW_STAGE' }, t.departmentId);
  }));
  return getTicketView(user, ticketId);
}

/** Records whether a result/report is pending or available. The result itself is never stored here. */
export async function setResultStatus(user: AuthUser, ticketId: number, status: 'PENDING' | 'AVAILABLE') {
  await afterCommit(transact(async (tx) => {
    const t = await lockTicket(tx, ticketId);
    assertDepartmentPermission(user, t.departmentId, 'results.status.update');
    if (parseJson<string[]>(t.department.serviceTypes, []).length === 0) throw badRequest('This department does not report results.');
    if (['CANCELLED', 'SKIPPED'].includes(t.status)) throw conflict('This ticket was cancelled or skipped.', 'INVALID_TRANSITION');
    if (t.resultStatus === status) return;
    await tx.queueTicket.update({ where: { id: t.id }, data: { resultStatus: status, version: { increment: 1 } } });
    await tx.journeyEvent.create({ data: { visitId: t.visitId, ticketId: t.id, departmentId: t.departmentId, eventType: 'RESULT_STATUS', userId: user.id, metadata: toJson({ from: t.resultStatus, to: status }) } });
    if (status === 'AVAILABLE' && t.referralId) {
      const ref = await tx.clinicalReferral.findUnique({ where: { id: t.referralId } });
      if (ref) {
        await notify(tx, {
          eventKey: `result-available:${t.id}`, departmentId: ref.fromDepartmentId, type: 'RESULT_AVAILABLE',
          title: `${t.department.name} result available for ${t.displayNumber}`, ticketId: t.id, visitId: t.visitId,
        });
      }
    }
    await enqueue(tx, 'queue.changed', { departmentId: t.departmentId, ticketId: t.id, displayNumber: t.displayNumber, status: t.status, eventType: 'RESULT_STATUS' }, t.departmentId);
  }));
  return getTicketView(user, ticketId);
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                    */
/* ------------------------------------------------------------------------ */

const ticketInclude = {
  department: { select: { id: true, name: true, code: true } },
  counter: { select: { id: true, name: true } },
  visit: { select: { id: true, visitNumber: true, isEmergency: true, patient: true } },
} as const;

type TicketWithRels = QueueTicket & {
  department: { id: number; name: string; code: string };
  counter: { id: number; name: string } | null;
  visit: { id: number; visitNumber: string; isEmergency: boolean; patient: Parameters<typeof patientCard>[0] };
};

export function serializeTicket(t: TicketWithRels, user: AuthUser) {
  const canSeePatient = can(user, 'patient.view');
  return {
    id: t.id, displayNumber: t.displayNumber, status: t.status, priority: t.priority, priorityReason: t.priorityReason,
    serviceType: t.serviceType, workflowStage: t.workflowStage, resultStatus: t.resultStatus, callCount: t.callCount,
    statusReason: t.statusReason, department: t.department, counter: t.counter, visitId: t.visitId, visitNumber: t.visit.visitNumber,
    isEmergency: t.visit.isEmergency, enteredAt: t.enteredAt, firstCalledAt: t.firstCalledAt, lastCalledAt: t.lastCalledAt,
    serviceStartedAt: t.serviceStartedAt, completedAt: t.completedAt, referralId: t.referralId,
    patient: canSeePatient ? patientCard(t.visit.patient) : null,
  };
}

export async function getTicketView(user: AuthUser, id: number) {
  const t = await prisma.queueTicket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw notFound('Ticket');
  if (!canAccessDepartment(user, t.departmentId, 'queue.view')) throw forbidden();
  const view = serializeTicket(t as TicketWithRels, user);
  let referral = null as null | { fromDepartment: string; serviceType: string | null; notes?: string | null };
  if (t.referralId) {
    const r = await prisma.clinicalReferral.findUnique({ where: { id: t.referralId }, include: { fromDepartment: { select: { name: true } } } });
    if (r) referral = { fromDepartment: r.fromDepartment.name, serviceType: r.serviceType, ...(can(user, 'referral.notes.view') ? { notes: r.notes } : {}) };
  }
  return { ...view, referral };
}

export async function getTicketHistory(user: AuthUser, id: number) {
  const t = await prisma.queueTicket.findUnique({ where: { id }, select: { departmentId: true } });
  if (!t) throw notFound('Ticket');
  if (!canAccessDepartment(user, t.departmentId, 'queue.view')) throw forbidden();
  const events = await prisma.journeyEvent.findMany({ where: { ticketId: id }, orderBy: { id: 'asc' }, include: { department: { select: { name: true } } } });
  const users = await prisma.user.findMany({ where: { id: { in: events.map((e) => e.userId).filter((x): x is number => !!x) } }, select: { id: true, fullName: true } });
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return events.map((e) => ({
    id: e.id, eventType: e.eventType, fromStatus: e.fromStatus, toStatus: e.toStatus, reason: e.reason, createdAt: e.createdAt,
    department: e.department?.name ?? null, user: e.userId ? name.get(e.userId) ?? null : null,
  }));
}

export async function getTicketSlip(user: AuthUser, id: number) {
  const t = await prisma.queueTicket.findUnique({ where: { id }, include: { department: true } });
  if (!t) throw notFound('Ticket');
  if (!canAccessDepartment(user, t.departmentId, 'queue.view') && !can(user, 'visit.create')) throw forbidden();
  const [hospital, footer, ahead] = await Promise.all([
    getSetting<string>('hospital.name'), getSetting<string>('ticket.footer'),
    prisma.queueTicket.count({ where: { departmentId: t.departmentId, status: 'WAITING', OR: [{ priority: { gt: t.priority } }, { priority: t.priority, enteredAt: { lt: t.enteredAt } }, { priority: t.priority, enteredAt: t.enteredAt, id: { lt: t.id } }] } }),
  ]);
  // Deliberately contains no personal or medical information.
  return {
    hospitalName: hospital, displayNumber: t.displayNumber, departmentName: t.department.name, issuedAt: t.enteredAt,
    date: localDateKey(t.enteredAt), peopleAhead: t.status === 'WAITING' ? ahead : 0, instructions: footer,
  };
}

export async function getDepartmentQueue(user: AuthUser, departmentId: number) {
  assertDepartmentPermission(user, departmentId, 'queue.view');
  const dept = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!dept) throw notFound('Department');
  const ordering = await getSetting<string>('queue.priorityOrdering');
  const todayStart = startOfLocalDay(localDateKey());
  const orderBy = ordering === 'arrival_only'
    ? [{ enteredAt: 'asc' as const }, { id: 'asc' as const }]
    : [{ priority: 'desc' as const }, { enteredAt: 'asc' as const }, { id: 'asc' as const }];

  const [waiting, waitingTotal, active, absent, recent, todayServed, incomingReferrals] = await Promise.all([
    prisma.queueTicket.findMany({ where: { departmentId, status: 'WAITING' }, orderBy, take: 200, include: ticketInclude }),
    prisma.queueTicket.count({ where: { departmentId, status: 'WAITING' } }),
    prisma.queueTicket.findMany({ where: { departmentId, status: { in: ['CALLED', 'IN_SERVICE', 'ON_HOLD'] } }, orderBy: { lastCalledAt: 'desc' }, include: ticketInclude }),
    prisma.queueTicket.findMany({ where: { departmentId, status: 'ABSENT' }, orderBy: { updatedAt: 'desc' }, include: ticketInclude }),
    prisma.queueTicket.findMany({ where: { departmentId, status: { in: ['COMPLETED', 'REFERRED'] }, completedAt: { gte: todayStart } }, orderBy: { completedAt: 'desc' }, take: 10, include: ticketInclude }),
    prisma.queueTicket.findMany({
      where: { departmentId, enteredAt: { gte: todayStart }, firstCalledAt: { not: null }, status: { not: 'CANCELLED' }, visit: { isTest: false } },
      select: { enteredAt: true, firstCalledAt: true, serviceStartedAt: true, completedAt: true, status: true },
    }),
    prisma.queueTicket.count({ where: { departmentId, status: 'WAITING', referralId: { not: null } } }),
  ]);

  const waits = todayServed.map((t) => seconds(t.enteredAt, t.firstCalledAt)).filter((x): x is number => x !== null);
  const now = new Date();
  const map = (t: unknown) => serializeTicket(t as TicketWithRels, user);
  const serializedWaiting = waiting.map((t, i) => ({ ...map(t), position: i + 1, waitingSeconds: seconds(t.enteredAt, now) }));
  return {
    department: { id: dept.id, name: dept.name, code: dept.code, workflowStages: parseJson<string[]>(dept.workflowStages, []), serviceTypes: parseJson<string[]>(dept.serviceTypes, []) },
    counts: { waiting: waitingTotal, inService: active.filter((t) => t.status === 'IN_SERVICE').length, called: active.filter((t) => t.status === 'CALLED').length, absent: absent.length, incomingReferrals },
    nextEligible: serializedWaiting[0] ?? null,
    waiting: serializedWaiting,
    active: active.map((t) => ({ ...map(t), serviceSeconds: t.serviceStartedAt ? seconds(t.serviceStartedAt, now) : null })),
    absent: absent.map(map),
    recentlyCompleted: recent.map(map),
    averageWaitSeconds: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
    generatedAt: now,
  };
}

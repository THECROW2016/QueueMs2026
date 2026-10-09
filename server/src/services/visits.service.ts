import type { Request } from 'express';
import { prisma, transact } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toJson } from '../utils/misc.js';
import { localDateKey, localRange } from '../utils/time.js';
import { audit } from './audit.service.js';
import { assertDepartmentPermission, can, canSeeAllDepartments, type AuthUser } from './access.service.js';
import { enqueue, nudgeOutbox } from './outbox.service.js';
import { createPatientTx, findDuplicates, serializePatient, type PatientInput } from './patients.service.js';
import { cancelAllForVisit, insertTicket } from './queue.service.js';
import { nextCounter } from './sequence.service.js';

export interface CreateVisitInput {
  patientId?: number;
  newPatient?: PatientInput;
  confirmDuplicate?: boolean;
  /** Client-generated key: submitting the same form twice returns the same visit and ticket. */
  idempotencyKey: string;
  reasonForVisit?: string | null;
}

const publicVisit = (v: { id: number; visitNumber: string; status: string; isEmergency: boolean; openedAt: Date; closedAt: Date | null; patientId: number; billingClearedAt: Date | null }) => ({
  id: v.id, visitNumber: v.visitNumber, status: v.status, isEmergency: v.isEmergency, openedAt: v.openedAt, closedAt: v.closedAt,
  patientId: v.patientId, billingCleared: !!v.billingClearedAt,
});

export async function createVisit(user: AuthUser, input: CreateVisitInput, req?: Request) {
  const reception = await prisma.department.findUnique({ where: { code: 'RECEPTION' } });
  if (!reception || !reception.isActive) throw badRequest('The Reception department is not configured.');
  assertDepartmentPermission(user, reception.id, 'visit.create');
  if (!input.patientId && !input.newPatient) throw badRequest('Choose an existing patient or supply new patient details.');
  if (input.patientId && input.newPatient) throw badRequest('Supply either an existing patient or new patient details, not both.');

  // Repeated submission of the same form: hand back what was already created.
  const prior = await prisma.visit.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { tickets: { where: { departmentId: reception.id }, take: 1, orderBy: { id: 'asc' } } } });
  if (prior) {
    if (prior.createdById !== user.id) throw conflict('That submission key belongs to another request.', 'IDEMPOTENCY_KEY_REUSED');
    return { visit: publicVisit(prior), ticket: prior.tickets[0] ? { id: prior.tickets[0].id, displayNumber: prior.tickets[0].displayNumber } : null, duplicate: true };
  }

  if (input.newPatient && !input.confirmDuplicate) {
    const candidates = await findDuplicates(prisma, input.newPatient);
    if (candidates.length) throw conflict('A similar patient record already exists. Check it before creating a new one.', 'DUPLICATE_SUSPECTED', { candidates });
  }

  try {
    const out = await transact(async (tx) => {
      const patient = input.patientId
        ? await tx.patient.findUnique({ where: { id: input.patientId } })
        : await createPatientTx(tx, input.newPatient!, user.id);
      if (!patient) throw notFound('Patient');

      // Lock the patient row so two receptionists cannot open two visits for the same person at once.
      await tx.$queryRaw`SELECT id FROM Patient WHERE id = ${patient.id} FOR UPDATE`;
      const open = await tx.visit.findFirst({ where: { patientId: patient.id, status: 'ACTIVE' }, select: { visitNumber: true, id: true } });
      if (open) throw conflict(`This patient already has an open visit (${open.visitNumber}).`, 'ACTIVE_VISIT_EXISTS', { visitId: open.id, visitNumber: open.visitNumber });

      const day = localDateKey().replaceAll('-', '');
      const n = await nextCounter(tx, `seq.visit.${day}`);
      const visit = await tx.visit.create({
        data: {
          visitNumber: `V${day}-${String(n).padStart(4, '0')}`, patientId: patient.id, idempotencyKey: input.idempotencyKey,
          reasonForVisit: input.reasonForVisit?.trim() || null, createdById: user.id,
        },
      });
      await tx.journeyEvent.create({ data: { visitId: visit.id, eventType: 'VISIT_CREATED', userId: user.id, metadata: toJson({ visitNumber: visit.visitNumber }) } });
      const ticket = await insertTicket(tx, { visitId: visit.id, department: reception, createdById: user.id });
      await audit({ userId: user.id, action: 'VISIT_CREATED', entityType: 'Visit', entityId: visit.id, metadata: { newPatient: !!input.newPatient, patientId: patient.id }, req }, tx);
      return { visit, ticket };
    });
    nudgeOutbox();
    return { visit: publicVisit(out.visit), ticket: { id: out.ticket.id, displayNumber: out.ticket.displayNumber }, duplicate: false };
  } catch (err) {
    // Two identical submissions raced: the loser hits the unique key and returns the winner's visit.
    if ((err as { code?: string }).code === 'P2002') {
      const winner = await prisma.visit.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { tickets: { take: 1, orderBy: { id: 'asc' } } } });
      if (winner) return { visit: publicVisit(winner), ticket: winner.tickets[0] ? { id: winner.tickets[0].id, displayNumber: winner.tickets[0].displayNumber } : null, duplicate: true };
    }
    throw err;
  }
}

/**
 * Need-to-know access: administrators and Reception can open any visit; other staff only
 * visits that have (or had) a ticket in one of their departments.
 */
export async function assertVisitAccess(user: AuthUser, visitId: number, permission = 'visit.view') {
  if (!can(user, permission)) throw forbidden();
  const visit = await prisma.visit.findUnique({ where: { id: visitId } });
  if (!visit) throw notFound('Visit');
  if (canSeeAllDepartments(user) || can(user, 'visit.create')) return visit;
  const seen = await prisma.queueTicket.findFirst({ where: { visitId, departmentId: { in: user.departmentIds } }, select: { id: true } });
  if (!seen) throw forbidden('You do not have access to this visit.');
  return visit;
}

export async function getVisit(user: AuthUser, visitId: number, req?: Request) {
  const base = await assertVisitAccess(user, visitId);
  const v = await prisma.visit.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      patient: true,
      tickets: { orderBy: { id: 'asc' }, include: { department: { select: { id: true, name: true, code: true } }, counter: { select: { name: true } } } },
      referrals: { orderBy: { id: 'asc' }, include: { fromDepartment: { select: { name: true } }, toDepartment: { select: { name: true } } } },
    },
  });
  if (can(user, 'patient.view')) await audit({ userId: user.id, action: 'PATIENT_VIEWED', entityType: 'Patient', entityId: v.patientId, metadata: { via: 'visit', visitId }, req });
  return {
    ...publicVisit(v),
    reasonForVisit: v.reasonForVisit, closureReason: v.closureReason,
    patient: can(user, 'patient.view') ? serializePatient(v.patient) : null,
    tickets: v.tickets.map((t) => ({
      id: t.id, displayNumber: t.displayNumber, status: t.status, priority: t.priority, serviceType: t.serviceType, workflowStage: t.workflowStage,
      resultStatus: t.resultStatus, department: t.department, counter: t.counter?.name ?? null, enteredAt: t.enteredAt, completedAt: t.completedAt,
    })),
    referrals: v.referrals.map((r) => ({
      id: r.id, from: r.fromDepartment.name, to: r.toDepartment.name, serviceType: r.serviceType, status: r.status, priority: r.priority, createdAt: r.createdAt,
      ...(can(user, 'referral.notes.view') ? { notes: r.notes } : {}),
    })),
  };
}

export async function listVisits(user: AuthUser, q: { page: number; pageSize: number; status?: string; from?: string; to?: string; patientId?: number }) {
  if (!can(user, 'visit.view')) throw forbidden();
  const scope = canSeeAllDepartments(user) || can(user, 'visit.create')
    ? {}
    : { tickets: { some: { departmentId: { in: user.departmentIds } } } };
  const where = {
    isTest: false, ...scope,
    ...(q.status ? { status: q.status as 'ACTIVE' | 'COMPLETED' | 'CANCELLED' } : {}),
    ...(q.patientId ? { patientId: q.patientId } : {}),
    ...(q.from && q.to ? { openedAt: localRange(q.from, q.to) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.visit.count({ where }),
    prisma.visit.findMany({
      where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { patient: { select: { id: true, mrn: true, fullName: true } }, _count: { select: { tickets: true } } },
    }),
  ]);
  const showPatient = can(user, 'patient.view');
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((v) => ({ ...publicVisit(v), ticketCount: v._count.tickets, patient: showPatient ? v.patient : null })),
  };
}

export async function cancelVisit(user: AuthUser, visitId: number, reason: string, req?: Request) {
  const reception = await prisma.department.findUniqueOrThrow({ where: { code: 'RECEPTION' } });
  assertDepartmentPermission(user, reception.id, 'visit.cancel');
  const why = reason.trim();
  if (!why) throw badRequest('A reason is required to cancel a visit.');
  await transact(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Visit WHERE id = ${visitId} FOR UPDATE`;
    const v = await tx.visit.findUnique({ where: { id: visitId } });
    if (!v) throw notFound('Visit');
    if (v.status !== 'ACTIVE') throw conflict(`This visit is already ${v.status.toLowerCase()}.`, 'INVALID_TRANSITION');
    const inService = await tx.queueTicket.count({ where: { visitId, status: 'IN_SERVICE' } });
    if (inService) throw conflict('A department is serving this patient right now. Ask them to finish or cancel their ticket first.', 'VISIT_IN_SERVICE');
    const cancelled = await cancelAllForVisit(tx, visitId, user, `Visit cancelled: ${why}`);
    await tx.visit.update({ where: { id: visitId }, data: { status: 'CANCELLED', closedAt: new Date(), closedById: user.id, closureReason: why.slice(0, 255) } });
    await tx.journeyEvent.create({ data: { visitId, eventType: 'VISIT_CANCELLED', userId: user.id, reason: why.slice(0, 255) } });
    await audit({ userId: user.id, action: 'VISIT_CANCELLED', entityType: 'Visit', entityId: visitId, metadata: { reason: why, ticketsCancelled: cancelled }, req }, tx);
    await enqueue(tx, 'display.refresh', {});
  });
  nudgeOutbox();
  return getVisit(user, visitId);
}

export async function closeVisit(user: AuthUser, visitId: number, reason: string | null | undefined, req?: Request) {
  const accounts = await prisma.department.findUniqueOrThrow({ where: { code: 'ACCOUNTS' } });
  assertDepartmentPermission(user, accounts.id, 'visit.close');
  await transact(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Visit WHERE id = ${visitId} FOR UPDATE`;
    const v = await tx.visit.findUnique({ where: { id: visitId } });
    if (!v) throw notFound('Visit');
    if (v.status !== 'ACTIVE') throw conflict(`This visit is already ${v.status.toLowerCase()}.`, 'INVALID_TRANSITION');
    const open = await tx.queueTicket.findMany({ where: { visitId, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] } }, select: { displayNumber: true } });
    if (open.length) throw conflict(`The visit still has open tickets: ${open.map((t) => t.displayNumber).join(', ')}.`, 'VISIT_HAS_OPEN_TICKETS');
    if (!v.billingClearedAt) throw conflict('Billing has not been cleared for this visit.', 'BILLING_NOT_CLEARED');
    await tx.visit.update({ where: { id: visitId }, data: { status: 'COMPLETED', closedAt: new Date(), closedById: user.id, closureReason: reason?.trim().slice(0, 255) || null } });
    await tx.journeyEvent.create({ data: { visitId, eventType: 'VISIT_CLOSED', userId: user.id, reason: reason?.trim().slice(0, 255) || null } });
    await audit({ userId: user.id, action: 'VISIT_CLOSED', entityType: 'Visit', entityId: visitId, req }, tx);
  });
  return getVisit(user, visitId);
}

import type { Request } from 'express';
import { prisma, transact } from '../db.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { parseJson, toJson } from '../utils/misc.js';
import { localRange } from '../utils/time.js';
import { audit } from './audit.service.js';
import type { AuthUser } from './access.service.js';
import { canSeeAllDepartments } from './access.service.js';

/* ------------------------------ Departments ------------------------------ */

type DeptRow = Awaited<ReturnType<typeof prisma.department.findFirstOrThrow>>;

export const serializeDepartment = (d: DeptRow) => ({
  id: d.id, code: d.code, name: d.name, ticketPrefix: d.ticketPrefix, sortOrder: d.sortOrder, isActive: d.isActive,
  isClinical: d.isClinical, sequencePolicy: d.sequencePolicy,
  workflowStages: parseJson<string[]>(d.workflowStages, []), serviceTypes: parseJson<string[]>(d.serviceTypes, []),
});

export async function listDepartments(user: AuthUser, opts: { includeInactive?: boolean } = {}) {
  const rows = await prisma.department.findMany({
    where: {
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(canSeeAllDepartments(user) ? {} : { id: { in: user.departmentIds } }),
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return rows.map(serializeDepartment);
}

export async function allActiveDepartmentIds(): Promise<number[]> {
  return (await prisma.department.findMany({ where: { isActive: true }, select: { id: true } })).map((d) => d.id);
}

export interface DepartmentInput {
  code?: string; name?: string; ticketPrefix?: string; sortOrder?: number; isActive?: boolean; isClinical?: boolean;
  sequencePolicy?: 'DAILY' | 'CONTINUOUS'; workflowStages?: string[]; serviceTypes?: string[];
}

export async function createDepartment(input: Required<Pick<DepartmentInput, 'code' | 'name' | 'ticketPrefix'>> & DepartmentInput, actor: AuthUser, req?: Request) {
  try {
    const d = await prisma.department.create({
      data: {
        code: input.code.toUpperCase(), name: input.name, ticketPrefix: input.ticketPrefix.toUpperCase(),
        sortOrder: input.sortOrder ?? 99, isClinical: input.isClinical ?? false, sequencePolicy: input.sequencePolicy ?? 'DAILY',
        workflowStages: toJson(input.workflowStages ?? []), serviceTypes: input.serviceTypes ? toJson(input.serviceTypes) : null,
      },
    });
    await audit({ userId: actor.id, action: 'DEPARTMENT_CREATED', entityType: 'Department', entityId: d.id, metadata: { ...input }, req });
    return serializeDepartment(d);
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('A department with that code already exists.', 'DUPLICATE');
    throw e;
  }
}

export async function updateDepartment(id: number, input: DepartmentInput, actor: AuthUser, req?: Request) {
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw notFound('Department');
  if (input.isActive === false) {
    const active = await prisma.queueTicket.count({ where: { departmentId: id, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] } } });
    if (active) throw conflict('This department still has active tickets. Clear its queue before deactivating it.', 'DEPARTMENT_BUSY');
  }
  const d = await prisma.department.update({
    where: { id },
    data: {
      name: input.name, ticketPrefix: input.ticketPrefix?.toUpperCase(), sortOrder: input.sortOrder, isActive: input.isActive,
      isClinical: input.isClinical, sequencePolicy: input.sequencePolicy,
      workflowStages: input.workflowStages ? toJson(input.workflowStages) : undefined,
      serviceTypes: input.serviceTypes ? toJson(input.serviceTypes) : undefined,
    },
  });
  await audit({ userId: actor.id, action: 'DEPARTMENT_UPDATED', entityType: 'Department', entityId: id, metadata: { ...input }, req });
  return serializeDepartment(d);
}

/* -------------------------------- Counters ------------------------------- */

export async function listCounters(departmentId?: number, includeInactive = false) {
  return prisma.serviceCounter.findMany({
    where: { ...(departmentId ? { departmentId } : {}), ...(includeInactive ? {} : { isActive: true }) },
    orderBy: [{ departmentId: 'asc' }, { name: 'asc' }],
  });
}

export async function createCounter(input: { departmentId: number; name: string; kind?: string }, actor: AuthUser, req?: Request) {
  const dept = await prisma.department.findUnique({ where: { id: input.departmentId } });
  if (!dept) throw badRequest('Department does not exist.');
  try {
    const c = await prisma.serviceCounter.create({ data: { departmentId: input.departmentId, name: input.name, kind: input.kind ?? 'COUNTER' } });
    await audit({ userId: actor.id, action: 'COUNTER_CREATED', entityType: 'ServiceCounter', entityId: c.id, metadata: { ...input }, req });
    return c;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('That department already has a counter with this name.', 'DUPLICATE');
    throw e;
  }
}

export async function updateCounter(id: number, input: { name?: string; kind?: string; isActive?: boolean }, actor: AuthUser, req?: Request) {
  const existing = await prisma.serviceCounter.findUnique({ where: { id } });
  if (!existing) throw notFound('Counter');
  if (input.isActive === false) {
    const busy = await prisma.queueTicket.count({ where: { counterId: id, status: { in: ['CALLED', 'IN_SERVICE', 'ON_HOLD'] } } });
    if (busy) throw conflict('This counter is serving a patient right now.', 'COUNTER_BUSY');
  }
  try {
    const c = await prisma.serviceCounter.update({ where: { id }, data: input });
    await audit({ userId: actor.id, action: 'COUNTER_UPDATED', entityType: 'ServiceCounter', entityId: id, metadata: { ...input }, req });
    return c;
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw conflict('That department already has a counter with this name.', 'DUPLICATE');
    throw e;
  }
}

/* ----------------------------- Routing rules ----------------------------- */

export const listRules = () =>
  prisma.routingRule.findMany({
    include: { from: { select: { id: true, name: true, code: true } }, to: { select: { id: true, name: true, code: true } } },
    orderBy: [{ fromDepartmentId: 'asc' }, { toDepartmentId: 'asc' }],
  });

export async function upsertRule(
  input: { fromDepartmentId: number; toDepartmentId: number; isActive?: boolean; requiresReason?: boolean; emergencyOnly?: boolean },
  actor: AuthUser, req?: Request,
) {
  if (input.fromDepartmentId === input.toDepartmentId) throw badRequest('A rule must connect two different departments.');
  const count = await prisma.department.count({ where: { id: { in: [input.fromDepartmentId, input.toDepartmentId] } } });
  if (count !== 2) throw badRequest('Department does not exist.');
  const rule = await prisma.routingRule.upsert({
    where: { fromDepartmentId_toDepartmentId: { fromDepartmentId: input.fromDepartmentId, toDepartmentId: input.toDepartmentId } },
    update: { isActive: input.isActive, requiresReason: input.requiresReason, emergencyOnly: input.emergencyOnly },
    create: {
      fromDepartmentId: input.fromDepartmentId, toDepartmentId: input.toDepartmentId,
      isActive: input.isActive ?? true, requiresReason: input.requiresReason ?? false, emergencyOnly: input.emergencyOnly ?? false,
    },
  });
  await audit({ userId: actor.id, action: 'ROUTING_RULE_SAVED', entityType: 'RoutingRule', entityId: rule.id, metadata: { ...input }, req });
  return rule;
}

export async function deleteRule(id: number, actor: AuthUser, req?: Request) {
  const r = await prisma.routingRule.findUnique({ where: { id } });
  if (!r) throw notFound('Routing rule');
  await prisma.routingRule.delete({ where: { id } });
  await audit({ userId: actor.id, action: 'ROUTING_RULE_DELETED', entityType: 'RoutingRule', entityId: id, req });
}

/* -------------------------------- Audit log ------------------------------ */

export async function listAudit(q: {
  page: number; pageSize: number; userId?: number; action?: string; entityType?: string; from?: string; to?: string;
}) {
  const where = {
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.from && q.to ? { createdAt: localRange(q.from, q.to) } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { user: { select: { id: true, username: true, fullName: true } } },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((r) => ({
      id: r.id, createdAt: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId,
      user: r.user, ipAddress: r.ipAddress, metadata: parseJson<Record<string, unknown> | null>(r.metadata, null),
    })),
  };
}

export { transact };

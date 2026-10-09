import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as admin from '../services/admin.service.js';
import * as users from '../services/users.service.js';
import { getSettings, updateSettings } from '../services/settings.service.js';
import { dateKey, id, idParam, pagination, parse } from '../validators/common.js';
import { ah } from '../utils/misc.js';
import { notFound } from '../utils/errors.js';

export const adminRoutes = Router();

/* ---------------------------------- Users --------------------------------- */

const createUserBody = z.object({
  username: z.string().trim().min(3).max(100).regex(/^[A-Za-z0-9._@-]+$/, 'Letters, numbers and . _ @ - only'),
  fullName: z.string().trim().min(1).max(190),
  email: z.string().trim().email().max(190).optional().nullable(),
  password: z.string().min(1).max(200),
  roleCodes: z.array(z.string()).min(1),
  departmentIds: z.array(id).optional(),
  mustChangePassword: z.boolean().optional(),
});
const updateUserBody = z.object({
  fullName: z.string().trim().min(1).max(190).optional(),
  email: z.string().trim().email().max(190).optional().nullable(),
  roleCodes: z.array(z.string()).min(1).optional(),
  departmentIds: z.array(id).optional(),
  isActive: z.boolean().optional(),
});

adminRoutes.get('/users', requirePermission('users.manage'), ah(async (req, res) => {
  const q = parse(pagination.extend({ search: z.string().max(100).optional(), isActive: z.enum(['true', 'false']).optional() }), req.query);
  res.json(await users.listUsers({ page: q.page, pageSize: q.pageSize, search: q.search, isActive: q.isActive ? q.isActive === 'true' : undefined }));
}));
adminRoutes.post('/users', requirePermission('users.manage'), ah(async (req, res) => {
  const body = parse(createUserBody, req.body);
  res.status(201).json(await users.createUser({ ...body, mustChangePassword: body.mustChangePassword ?? true }, req.auth!.user.id, req));
}));
adminRoutes.get('/users/:id', requirePermission('users.manage'), ah(async (req, res) => {
  res.json(await users.getUser(parse(idParam, req.params).id));
}));
adminRoutes.patch('/users/:id', requirePermission('users.manage'), ah(async (req, res) => {
  const { id: userId } = parse(idParam, req.params);
  res.json(await users.updateUser(userId, parse(updateUserBody, req.body), req.auth!.user, req));
}));
adminRoutes.post('/users/:id/reset-password', requirePermission('users.manage'), ah(async (req, res) => {
  const { id: userId } = parse(idParam, req.params);
  res.json(await users.createPasswordReset(userId, req.auth!.user.id, req));
}));
adminRoutes.get('/roles', requirePermission('users.manage'), ah(async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { id: 'asc' } });
  res.json(roles.map((r) => ({ code: r.code, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.permission.code).sort() })));
}));

/* ------------------------------- Departments ------------------------------ */

const deptFields = {
  name: z.string().trim().min(1).max(100),
  ticketPrefix: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  isClinical: z.boolean(),
  sequencePolicy: z.enum(['DAILY', 'CONTINUOUS']),
  workflowStages: z.array(z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/, 'Use UPPER_SNAKE_CASE')).max(20),
  serviceTypes: z.array(z.string().trim().min(1).max(60)).max(30),
};

// Any signed-in user gets the departments they may see (for selectors); admins get all.
adminRoutes.get('/departments', requireAuth, ah(async (req, res) => {
  const includeInactive = req.auth!.user.permissions.has('departments.manage') && req.query.includeInactive === 'true';
  res.json(await admin.listDepartments(req.auth!.user, { includeInactive }));
}));
adminRoutes.post('/departments', requirePermission('departments.manage'), ah(async (req, res) => {
  const body = parse(z.object({ code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_]+$/), ...deptFields }).partial({
    sortOrder: true, isActive: true, isClinical: true, sequencePolicy: true, workflowStages: true, serviceTypes: true,
  }), req.body);
  res.status(201).json(await admin.createDepartment(body as Parameters<typeof admin.createDepartment>[0], req.auth!.user, req));
}));
adminRoutes.patch('/departments/:id', requirePermission('departments.manage'), ah(async (req, res) => {
  const { id: deptId } = parse(idParam, req.params);
  res.json(await admin.updateDepartment(deptId, parse(z.object(deptFields).partial(), req.body), req.auth!.user, req));
}));

/* --------------------------------- Counters -------------------------------- */

adminRoutes.get('/counters', requireAuth, ah(async (req, res) => {
  const q = parse(z.object({ departmentId: id.optional(), includeInactive: z.enum(['true', 'false']).optional() }), req.query);
  const u = req.auth!.user;
  const rows = await admin.listCounters(q.departmentId, u.permissions.has('counters.manage') && q.includeInactive === 'true');
  const visible = u.permissions.has('dashboard.admin') ? rows : rows.filter((c) => u.departmentIds.includes(c.departmentId));
  res.json(visible);
}));
adminRoutes.post('/counters', requirePermission('counters.manage'), ah(async (req, res) => {
  const body = parse(z.object({ departmentId: id, name: z.string().trim().min(1).max(100), kind: z.enum(['COUNTER', 'ROOM']).optional() }), req.body);
  res.status(201).json(await admin.createCounter(body, req.auth!.user, req));
}));
adminRoutes.patch('/counters/:id', requirePermission('counters.manage'), ah(async (req, res) => {
  const { id: counterId } = parse(idParam, req.params);
  const body = parse(z.object({ name: z.string().trim().min(1).max(100), kind: z.enum(['COUNTER', 'ROOM']), isActive: z.boolean() }).partial(), req.body);
  res.json(await admin.updateCounter(counterId, body, req.auth!.user, req));
}));

/* ------------------------------ Routing rules ------------------------------ */

adminRoutes.get('/routing-rules', requireAuth, ah(async (_req, res) => {
  res.json(await admin.listRules());
}));
adminRoutes.put('/routing-rules', requirePermission('routing.manage'), ah(async (req, res) => {
  const body = parse(z.object({
    fromDepartmentId: id, toDepartmentId: id, isActive: z.boolean().optional(), requiresReason: z.boolean().optional(), emergencyOnly: z.boolean().optional(),
  }), req.body);
  res.json(await admin.upsertRule(body, req.auth!.user, req));
}));
adminRoutes.delete('/routing-rules/:id', requirePermission('routing.manage'), ah(async (req, res) => {
  await admin.deleteRule(parse(idParam, req.params).id, req.auth!.user, req);
  res.status(204).end();
}));

/* ---------------------------- Settings and audit --------------------------- */

adminRoutes.get('/settings', requireAuth, ah(async (_req, res) => {
  res.json(await getSettings());
}));
adminRoutes.patch('/settings', requirePermission('settings.manage'), ah(async (req, res) => {
  const body = parse(z.record(z.unknown()), req.body);
  res.json(await updateSettings(body, req.auth!.user.id, req));
}));

adminRoutes.get('/audit-logs', requirePermission('audit.view'), ah(async (req, res) => {
  const q = parse(pagination.extend({
    userId: id.optional(), action: z.string().max(60).optional(), entityType: z.string().max(40).optional(),
    from: dateKey.optional(), to: dateKey.optional(),
  }), req.query);
  if (!!q.from !== !!q.to) throw notFound('Date range (supply both from and to)');
  res.json(await admin.listAudit(q));
}));

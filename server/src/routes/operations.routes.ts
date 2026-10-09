import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import * as billing from '../services/billing.service.js';
import { getJourney } from '../services/journey.service.js';
import * as notifications from '../services/notifications.service.js';
import * as patients from '../services/patients.service.js';
import * as queue from '../services/queue.service.js';
import * as visits from '../services/visits.service.js';
import { dateKey, id, idParam, pagination, parse } from '../validators/common.js';
import { ah } from '../utils/misc.js';
import { notFound } from '../utils/errors.js';

export const operationsRoutes = Router();

const user = (req: Express.Request) => req.auth!.user;

/* -------------------------------- Patients -------------------------------- */

const patientBody = z.object({
  fullName: z.string().trim().min(2).max(190),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d) <= new Date(), 'Date of birth cannot be in the future').optional().nullable(),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN']).optional(),
  phone: z.string().trim().max(30).optional().nullable(),
  nationalId: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(255).optional().nullable(),
});

operationsRoutes.post('/patients', requirePermission('patient.register'), ah(async (req, res) => {
  const { confirmDuplicate, ...rest } = parse(patientBody.extend({ confirmDuplicate: z.boolean().optional() }), req.body);
  res.status(201).json(await patients.registerPatient(user(req), rest, { confirmDuplicate }, req));
}));
operationsRoutes.get('/patients', requirePermission('patient.search'), ah(async (req, res) => {
  const q = parse(pagination.extend({ q: z.string().trim().min(2).max(100) }), req.query);
  res.json(await patients.searchPatients(user(req), q, req));
}));
operationsRoutes.get('/patients/:id', requirePermission('patient.view'), ah(async (req, res) => {
  res.json(await patients.getPatient(user(req), parse(idParam, req.params).id, req));
}));
operationsRoutes.patch('/patients/:id', requirePermission('patient.edit'), ah(async (req, res) => {
  res.json(await patients.updatePatient(user(req), parse(idParam, req.params).id, parse(patientBody.partial(), req.body), req));
}));

/* --------------------------------- Visits --------------------------------- */

operationsRoutes.post('/visits', requirePermission('visit.create'), ah(async (req, res) => {
  const body = parse(z.object({
    patientId: id.optional(), newPatient: patientBody.optional(), confirmDuplicate: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(8).max(80), reasonForVisit: z.string().trim().max(255).optional().nullable(),
  }), req.body);
  const out = await visits.createVisit(user(req), body, req);
  res.status(out.duplicate ? 200 : 201).json(out);
}));
operationsRoutes.get('/visits', requirePermission('visit.view'), ah(async (req, res) => {
  const q = parse(pagination.extend({
    status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(), from: dateKey.optional(), to: dateKey.optional(), patientId: id.optional(),
  }), req.query);
  if (!!q.from !== !!q.to) throw notFound('Date range (supply both from and to)');
  res.json(await visits.listVisits(user(req), q));
}));
operationsRoutes.get('/visits/:id', requirePermission('visit.view'), ah(async (req, res) => {
  res.json(await visits.getVisit(user(req), parse(idParam, req.params).id, req));
}));
operationsRoutes.post('/visits/:id/cancel', requirePermission('visit.cancel'), ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(255) }), req.body);
  res.json(await visits.cancelVisit(user(req), parse(idParam, req.params).id, reason, req));
}));
operationsRoutes.post('/visits/:id/close', requirePermission('visit.close'), ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(255).optional() }), req.body);
  res.json(await visits.closeVisit(user(req), parse(idParam, req.params).id, reason, req));
}));
operationsRoutes.get('/visits/:id/journey', ah(async (req, res) => {
  const journey = await getJourney(user(req), parse(idParam, req.params).id);
  if (!journey) return void res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
  res.json(journey);
}));

/* --------------------------------- Billing -------------------------------- */

operationsRoutes.get('/visits/:id/invoices', requirePermission('billing.view'), ah(async (req, res) => {
  res.json(await billing.listInvoices(user(req), parse(idParam, req.params).id));
}));
operationsRoutes.post('/visits/:id/invoices', requirePermission('billing.manage'), ah(async (req, res) => {
  const body = parse(z.object({ description: z.string().trim().max(255).optional().nullable(), totalMinor: z.number().int().min(1).max(1_000_000_000), currency: z.string().length(3).optional() }), req.body);
  res.status(201).json(await billing.createInvoice(user(req), parse(idParam, req.params).id, body, req));
}));
operationsRoutes.post('/visits/:id/clear-billing', requirePermission('billing.manage'), ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(255).optional() }), req.body);
  res.json(await billing.clearBilling(user(req), parse(idParam, req.params).id, reason, req));
}));
operationsRoutes.post('/invoices/:id/payments', requirePermission('billing.manage'), ah(async (req, res) => {
  const body = parse(z.object({
    amountMinor: z.number().int().min(1).max(1_000_000_000), method: z.enum(['CASH', 'MPESA', 'CARD', 'BANK', 'INSURANCE']),
    reference: z.string().trim().max(80).optional().nullable(), confirmed: z.boolean(), idempotencyKey: z.string().trim().min(8).max(80).optional().nullable(),
  }), req.body);
  const out = await billing.recordPayment(user(req), parse(idParam, req.params).id, body, req);
  res.status(out.duplicate ? 200 : 201).json(out);
}));
operationsRoutes.post('/invoices/:id/void', requirePermission('billing.manage'), ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(255) }), req.body);
  res.json(await billing.voidInvoice(user(req), parse(idParam, req.params).id, reason, req));
}));
operationsRoutes.get('/payments/:id/receipt', requirePermission('billing.view'), ah(async (req, res) => {
  res.json(await billing.getReceipt(user(req), parse(idParam, req.params).id));
}));

/* ---------------------------------- Queue --------------------------------- */

const stepSchema = z.object({
  departmentId: id,
  serviceType: z.string().trim().max(60).optional().nullable(),
  priority: z.number().int().min(0).max(2).optional(),
  reason: z.string().trim().max(255).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  emergency: z.boolean().optional(),
});

operationsRoutes.get('/departments/:id/queue', requirePermission('queue.view'), ah(async (req, res) => {
  res.json(await queue.getDepartmentQueue(user(req), parse(idParam, req.params).id));
}));
operationsRoutes.post('/departments/:id/call-next', requirePermission('queue.call'), ah(async (req, res) => {
  const { counterId } = parse(z.object({ counterId: id }), req.body);
  const ticket = await queue.callNext(user(req), { departmentId: parse(idParam, req.params).id, counterId });
  res.json({ ticket });
}));

operationsRoutes.get('/tickets/:id', requirePermission('queue.view'), ah(async (req, res) => {
  res.json(await queue.getTicketView(user(req), parse(idParam, req.params).id));
}));
operationsRoutes.get('/tickets/:id/history', requirePermission('queue.view'), ah(async (req, res) => {
  res.json(await queue.getTicketHistory(user(req), parse(idParam, req.params).id));
}));
operationsRoutes.get('/tickets/:id/slip', ah(async (req, res) => {
  res.json(await queue.getTicketSlip(user(req), parse(idParam, req.params).id));
}));

const ticketId = (req: { params: unknown }) => parse(idParam, req.params).id;
const reasonBody = z.object({ reason: z.string().trim().max(255).optional().nullable() });

operationsRoutes.post('/tickets/:id/recall', requirePermission('queue.call'), ah(async (req, res) => {
  res.json(await queue.recall(user(req), ticketId(req)));
}));
operationsRoutes.post('/tickets/:id/start', requirePermission('queue.serve'), ah(async (req, res) => {
  res.json(await queue.startService(user(req), ticketId(req)));
}));
operationsRoutes.post('/tickets/:id/hold', requirePermission('queue.serve'), ah(async (req, res) => {
  res.json(await queue.hold(user(req), ticketId(req), parse(reasonBody, req.body).reason));
}));
operationsRoutes.post('/tickets/:id/resume', requirePermission('queue.serve'), ah(async (req, res) => {
  res.json(await queue.resume(user(req), ticketId(req)));
}));
operationsRoutes.post('/tickets/:id/absent', requirePermission('queue.absent'), ah(async (req, res) => {
  res.json(await queue.markAbsent(user(req), ticketId(req), parse(reasonBody, req.body).reason));
}));
operationsRoutes.post('/tickets/:id/restore', requirePermission('queue.absent'), ah(async (req, res) => {
  res.json(await queue.restoreAbsent(user(req), ticketId(req)));
}));
operationsRoutes.post('/tickets/:id/skip', requirePermission('queue.skip'), ah(async (req, res) => {
  res.json(await queue.skip(user(req), ticketId(req), parse(reasonBody, req.body).reason));
}));
operationsRoutes.post('/tickets/:id/cancel', requirePermission('queue.cancel'), ah(async (req, res) => {
  res.json(await queue.cancel(user(req), ticketId(req), parse(reasonBody, req.body).reason));
}));
operationsRoutes.post('/tickets/:id/complete', requirePermission('queue.complete'), ah(async (req, res) => {
  const body = parse(z.object({ next: z.array(stepSchema).max(6).optional(), note: z.string().trim().max(255).optional().nullable() }), req.body);
  res.json(await queue.complete(user(req), ticketId(req), body));
}));
operationsRoutes.post('/tickets/:id/transfer', requirePermission('queue.transfer'), ah(async (req, res) => {
  res.json(await queue.transfer(user(req), ticketId(req), parse(stepSchema, req.body)));
}));
operationsRoutes.post('/tickets/:id/priority', requirePermission('queue.priority'), ah(async (req, res) => {
  res.json(await queue.setPriority(user(req), ticketId(req), parse(z.object({ priority: z.number().int().min(0).max(2), reason: z.string().trim().max(255).optional().nullable() }), req.body)));
}));
operationsRoutes.post('/tickets/:id/workflow', requirePermission('queue.serve'), ah(async (req, res) => {
  const { stage } = parse(z.object({ stage: z.string().trim().min(1).max(60) }), req.body);
  res.json(await queue.setWorkflowStage(user(req), ticketId(req), stage));
}));
operationsRoutes.post('/tickets/:id/result-status', requirePermission('results.status.update'), ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['PENDING', 'AVAILABLE']) }), req.body);
  res.json(await queue.setResultStatus(user(req), ticketId(req), status));
}));

/* ----------------------------- Notifications ------------------------------ */

operationsRoutes.get('/notifications', requirePermission('notifications.view'), ah(async (req, res) => {
  const q = parse(pagination.extend({
    afterId: id.optional(), unreadOnly: z.enum(['true', 'false']).optional(), departmentId: id.optional(),
  }), req.query);
  res.json(await notifications.listNotifications(user(req), { ...q, unreadOnly: q.unreadOnly === 'true' }));
}));
operationsRoutes.post('/notifications/read', requirePermission('notifications.view'), ah(async (req, res) => {
  const body = parse(z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() }).refine((b) => b.all || b.ids?.length, 'Provide ids or all'), req.body);
  res.json(await notifications.markRead(user(req), body));
}));

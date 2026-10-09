import type { Request } from 'express';
import { prisma, transact } from '../db.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { toJson } from '../utils/misc.js';
import { audit } from './audit.service.js';
import { assertDepartmentPermission, type AuthUser } from './access.service.js';
import { nextCounter } from './sequence.service.js';
import { getSetting } from './settings.service.js';
import { assertVisitAccess } from './visits.service.js';

type InvoiceRow = Awaited<ReturnType<typeof prisma.invoice.findFirstOrThrow<{ include: { payments: true } }>>>;

const serializeInvoice = (i: InvoiceRow) => ({
  id: i.id, invoiceNumber: i.invoiceNumber, visitId: i.visitId, description: i.description, currency: i.currency, status: i.status,
  totalMinor: i.totalMinor, paidMinor: i.paidMinor, balanceMinor: i.status === 'VOID' ? 0 : i.totalMinor - i.paidMinor, createdAt: i.createdAt,
  payments: i.payments.map((p) => ({ id: p.id, amountMinor: p.amountMinor, method: p.method, reference: p.reference, receiptNumber: p.receiptNumber, createdAt: p.createdAt })),
});

async function accountsDept() {
  return prisma.department.findUniqueOrThrow({ where: { code: 'ACCOUNTS' } });
}

export async function listInvoices(user: AuthUser, visitId: number) {
  await assertVisitAccess(user, visitId, 'billing.view');
  const rows = await prisma.invoice.findMany({ where: { visitId }, include: { payments: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
  const invoices = rows.map(serializeInvoice);
  const live = invoices.filter((i) => i.status !== 'VOID');
  return {
    invoices,
    totals: { totalMinor: live.reduce((a, i) => a + i.totalMinor, 0), paidMinor: live.reduce((a, i) => a + i.paidMinor, 0), balanceMinor: live.reduce((a, i) => a + i.balanceMinor, 0) },
  };
}

export async function createInvoice(user: AuthUser, visitId: number, input: { description?: string | null; totalMinor: number; currency?: string }, req?: Request) {
  assertDepartmentPermission(user, (await accountsDept()).id, 'billing.manage');
  const visit = await assertVisitAccess(user, visitId, 'billing.manage');
  if (visit.status !== 'ACTIVE') throw conflict('Invoices can only be raised on an active visit.', 'INVALID_TRANSITION');
  const year = new Date().getUTCFullYear();
  const inv = await transact(async (tx) => {
    const n = await nextCounter(tx, `seq.invoice.${year}`);
    const created = await tx.invoice.create({
      data: { invoiceNumber: `INV-${year}-${String(n).padStart(6, '0')}`, visitId, description: input.description?.trim() || null, totalMinor: input.totalMinor, currency: input.currency ?? 'KES', createdById: user.id },
      include: { payments: true },
    });
    // A new charge reopens billing clearance.
    await tx.visit.update({ where: { id: visitId }, data: { billingClearedAt: null } });
    await tx.journeyEvent.create({ data: { visitId, eventType: 'INVOICE_CREATED', userId: user.id, metadata: toJson({ invoiceNumber: created.invoiceNumber, totalMinor: input.totalMinor }) } });
    await audit({ userId: user.id, action: 'INVOICE_CREATED', entityType: 'Invoice', entityId: created.id, metadata: { visitId, totalMinor: input.totalMinor }, req }, tx);
    return created;
  });
  return serializeInvoice(inv);
}

export interface PaymentInput {
  amountMinor: number;
  method: 'CASH' | 'MPESA' | 'CARD' | 'BANK' | 'INSURANCE';
  reference?: string | null;
  /** The cashier explicitly confirms the money was received / the payment system confirmed it. */
  confirmed: boolean;
  idempotencyKey?: string | null;
}

/** Records a payment that staff or the payment system has confirmed. It never marks anything paid on its own. */
export async function recordPayment(user: AuthUser, invoiceId: number, input: PaymentInput, req?: Request) {
  assertDepartmentPermission(user, (await accountsDept()).id, 'billing.manage');
  if (input.confirmed !== true) throw badRequest('Payment must be confirmed as received before it can be recorded.');
  if (input.method !== 'CASH' && !input.reference?.trim()) throw badRequest('A payment reference is required for non-cash payments.');

  if (input.idempotencyKey) {
    const prior = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { invoice: { include: { payments: true } } } });
    if (prior) return { invoice: serializeInvoice(prior.invoice), receiptNumber: prior.receiptNumber, duplicate: true };
  }
  const result = await transact(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Invoice WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'VOID') throw conflict('This invoice has been voided.', 'INVALID_TRANSITION');
    if (inv.status === 'PAID') throw conflict('This invoice is already paid in full.', 'INVALID_TRANSITION');
    const balance = inv.totalMinor - inv.paidMinor;
    if (input.amountMinor > balance) throw badRequest('The payment is larger than the outstanding balance.');

    const year = new Date().getUTCFullYear();
    const n = await nextCounter(tx, `seq.receipt.${year}`);
    const receiptNumber = `RCP-${year}-${String(n).padStart(6, '0')}`;
    await tx.payment.create({
      data: { invoiceId, amountMinor: input.amountMinor, method: input.method, reference: input.reference?.trim() || null, receiptNumber, idempotencyKey: input.idempotencyKey ?? null, confirmedById: user.id },
    });
    const paid = inv.paidMinor + input.amountMinor;
    const updated = await tx.invoice.update({
      where: { id: invoiceId }, data: { paidMinor: paid, status: paid >= inv.totalMinor ? 'PAID' : 'PARTIALLY_PAID' }, include: { payments: { orderBy: { id: 'asc' } } },
    });
    await tx.journeyEvent.create({ data: { visitId: inv.visitId, eventType: 'PAYMENT_RECORDED', userId: user.id, metadata: toJson({ receiptNumber, amountMinor: input.amountMinor, method: input.method }) } });
    await audit({ userId: user.id, action: 'PAYMENT_RECORDED', entityType: 'Invoice', entityId: invoiceId, metadata: { receiptNumber, amountMinor: input.amountMinor, method: input.method, reference: input.reference ?? null }, req }, tx);
    return { invoice: serializeInvoice(updated), receiptNumber, duplicate: false };
  });
  return result;
}

export async function voidInvoice(user: AuthUser, invoiceId: number, reason: string, req?: Request) {
  assertDepartmentPermission(user, (await accountsDept()).id, 'billing.manage');
  const why = reason.trim();
  if (!why) throw badRequest('A reason is required to void an invoice.');
  const out = await transact(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Invoice WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw notFound('Invoice');
    if (inv.paidMinor > 0) throw conflict('An invoice with payments cannot be voided.', 'INVALID_TRANSITION');
    if (inv.status === 'VOID') return inv;
    const v = await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' }, include: { payments: true } });
    await audit({ userId: user.id, action: 'INVOICE_VOIDED', entityType: 'Invoice', entityId: invoiceId, metadata: { reason: why }, req }, tx);
    return v;
  });
  return { id: out.id, status: 'VOID' };
}

/** Marks billing as cleared once every live invoice is paid (or explicitly records "no charges"). */
export async function clearBilling(user: AuthUser, visitId: number, reason: string | null | undefined, req?: Request) {
  assertDepartmentPermission(user, (await accountsDept()).id, 'billing.manage');
  await assertVisitAccess(user, visitId, 'billing.manage');
  await transact(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Visit WHERE id = ${visitId} FOR UPDATE`;
    const invoices = await tx.invoice.findMany({ where: { visitId, status: { not: 'VOID' } } });
    const owing = invoices.filter((i) => i.paidMinor < i.totalMinor);
    if (owing.length) throw conflict(`Outstanding balance on ${owing.map((i) => i.invoiceNumber).join(', ')}.`, 'OUTSTANDING_BALANCE');
    if (!invoices.length && !reason?.trim()) throw badRequest('There are no invoices. Give a reason (for example "No charges") to clear billing.');
    await tx.visit.update({ where: { id: visitId }, data: { billingClearedAt: new Date() } });
    await tx.journeyEvent.create({ data: { visitId, eventType: 'BILLING_CLEARED', userId: user.id, reason: reason?.trim().slice(0, 255) || null } });
    await audit({ userId: user.id, action: 'BILLING_CLEARED', entityType: 'Visit', entityId: visitId, metadata: { reason: reason ?? null }, req }, tx);
  });
  return { billingCleared: true };
}

export async function getReceipt(user: AuthUser, paymentId: number) {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: { include: { visit: { include: { patient: true } } } } } });
  if (!p) throw notFound('Receipt');
  await assertVisitAccess(user, p.invoice.visitId, 'billing.view');
  return {
    hospitalName: await getSetting<string>('hospital.name'), receiptNumber: p.receiptNumber, invoiceNumber: p.invoice.invoiceNumber,
    patientName: p.invoice.visit.patient.fullName, mrn: p.invoice.visit.patient.mrn, visitNumber: p.invoice.visit.visitNumber,
    amountMinor: p.amountMinor, currency: p.invoice.currency, method: p.method, reference: p.reference, paidAt: p.createdAt,
    balanceMinor: p.invoice.totalMinor - p.invoice.paidMinor,
  };
}

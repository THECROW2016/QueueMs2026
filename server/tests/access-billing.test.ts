import request from 'supertest';
import { app } from './helpers.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { callAndStart, clearClinicalData, deptId, freshDatabase, makeStaff, newVisit, randomName, toConsultation, userClient } from './helpers.js';

let staff: Awaited<ReturnType<typeof makeStaff>>;
beforeAll(async () => { await freshDatabase(); staff = await makeStaff(); });
beforeEach(async () => { await clearClinicalData(); });

describe('patients and duplicates', () => {
  it('warns about a probable duplicate and only creates it when confirmed', async () => {
    const body = { fullName: randomName(), dateOfBirth: '1985-02-03', sex: 'MALE', phone: '0712345678' };
    expect((await staff.reception.post('/api/patients', body)).status).toBe(201);
    const dup = await staff.reception.post('/api/patients', { ...body, fullName: body.fullName.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_SUSPECTED');
    expect(dup.body.error.details.candidates).toHaveLength(1);
    expect((await staff.reception.post('/api/patients', { ...body, confirmDuplicate: true })).status).toBe(201);
  });

  it('rejects a future date of birth and a missing name', async () => {
    expect((await staff.reception.post('/api/patients', { fullName: 'A', dateOfBirth: '1990-01-01' })).status).toBe(400);
    expect((await staff.reception.post('/api/patients', { fullName: 'Valid Name', dateOfBirth: '2999-01-01' })).status).toBe(400);
  });

  it('replays a visit creation with the same idempotency key without a second ticket', async () => {
    const body = { newPatient: { fullName: randomName(), dateOfBirth: '1991-01-01', sex: 'FEMALE' }, idempotencyKey: 'idem-key-12345678' };
    const a = await staff.reception.post('/api/visits', body);
    const b = await staff.reception.post('/api/visits', body);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.visit.id).toBe(a.body.visit.id);
    expect(await prisma.queueTicket.count()).toBe(1);
  });
});

describe('access control', () => {
  it('blocks users who lack the permission or department, and unauthenticated callers', async () => {
    const v = await newVisit(staff.reception);
    expect((await request(app).get('/api/visits')).status).toBe(401);
    // Pharmacy cannot register patients or call from Triage.
    expect((await staff.pharmacy.post('/api/visits', { newPatient: { fullName: randomName() }, idempotencyKey: 'abcdefgh12' })).status).toBe(403);
    const triage = await deptId('TRIAGE');
    const { counters } = await prisma.serviceCounter.findMany({ where: { departmentId: triage } }).then((c) => ({ counters: c }));
    expect((await staff.pharmacy.post(`/api/departments/${triage}/call-next`, { counterId: counters[0]!.id })).status).toBe(403);
    expect((await staff.reception.post(`/api/tickets/${v.ticketId}/skip`, { reason: 'x' })).status).not.toBe(500);
  });

  it('refuses state changes without a CSRF token', async () => {
    const res = await staff.reception.agent.post('/api/visits').send({});
    expect(res.status).toBe(403);
  });

  it('gives non-clinical staff a restricted journey and clinical staff the full timeline', async () => {
    const v = await toConsultation(staff);
    const pharmacy = (await staff.pharmacy.get(`/api/visits/${v.visitId}/journey`));
    // Pharmacy has no ticket for this visit yet, so it has no need-to-know.
    expect(pharmacy.status).toBe(403);
    const full = (await staff.consultation.get(`/api/visits/${v.visitId}/journey`)).body;
    expect(full.view).toBe('full');
    expect(full.timeline.length).toBeGreaterThan(3);
    const summary = (await staff.reception.get(`/api/visits/${v.visitId}/journey`)).body;
    expect(summary.view).toBe('summary');
    expect(summary.timeline).toBeUndefined();
    expect(JSON.stringify(summary)).not.toMatch(/calledBy|servedBy|statusReason/);
  });

  it('does not give reception staff access to clinical referral notes', async () => {
    const nurse = await userClient(['RECEPTION'], ['RECEPTION']);
    expect(nurse.user.permissions).not.toContain('referral.notes.view');
  });
});

describe('visit cancellation', () => {
  it('cancels every open ticket and refuses while a patient is in service', async () => {
    const v = await newVisit(staff.reception);
    await callAndStart(staff.reception, 'RECEPTION');
    const blocked = await staff.reception.post(`/api/visits/${v.visitId}/cancel`, { reason: 'Left' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('VISIT_IN_SERVICE');
    await staff.reception.post(`/api/tickets/${v.ticketId}/cancel`, { reason: 'Mistake' });
    const v2 = await newVisit(staff.reception);
    expect((await staff.reception.post(`/api/visits/${v2.visitId}/cancel`, {})).status).toBe(400);
    const ok = await staff.reception.post(`/api/visits/${v2.visitId}/cancel`, { reason: 'Patient left' });
    expect(ok.status).toBe(200);
    expect((await prisma.queueTicket.findUniqueOrThrow({ where: { id: v2.ticketId } })).status).toBe('CANCELLED');
  });
});

/** Sends a new visit's Reception ticket on to Accounts, which is what gives Accounts staff access to it. */
async function visitAtAccounts() {
  const v = await newVisit(staff.reception);
  const rec = await callAndStart(staff.reception, 'RECEPTION');
  expect((await staff.reception.post(`/api/tickets/${rec.id}/complete`, { next: [{ departmentId: await deptId('ACCOUNTS') }] })).status).toBe(200);
  return v;
}

describe('billing', () => {
  it('takes only confirmed payments, never overpays, and clears billing when settled', async () => {
    const v = await visitAtAccounts();
    const inv = await staff.accounts.post(`/api/visits/${v.visitId}/invoices`, { description: 'Consultation', totalMinor: 150000 });
    expect(inv.status).toBe(201);
    const pay = (body: object) => staff.accounts.post(`/api/invoices/${inv.body.id}/payments`, body);
    expect((await pay({ amountMinor: 50000, method: 'CASH', confirmed: false })).status).toBe(400);
    expect((await pay({ amountMinor: 50000, method: 'MPESA', confirmed: true })).status).toBe(400); // reference needed
    expect((await pay({ amountMinor: 999999, method: 'CASH', confirmed: true })).status).toBe(400);
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, {})).status).toBe(409);
    const first = await pay({ amountMinor: 50000, method: 'CASH', confirmed: true, idempotencyKey: 'pay-key-0001' });
    expect(first.body.invoice.status).toBe('PARTIALLY_PAID');
    const replay = await pay({ amountMinor: 50000, method: 'CASH', confirmed: true, idempotencyKey: 'pay-key-0001' });
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.invoice.paidMinor).toBe(50000);
    const last = await pay({ amountMinor: 100000, method: 'MPESA', reference: 'QWE123', confirmed: true });
    expect(last.body.invoice.status).toBe('PAID');
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, {})).status).toBe(200);
    const list = (await staff.accounts.get(`/api/visits/${v.visitId}/invoices`)).body;
    expect(list.totals.balanceMinor).toBe(0);
  });

  it('refuses billing actions from other departments', async () => {
    const v = await visitAtAccounts();
    expect((await staff.triage.post(`/api/visits/${v.visitId}/invoices`, { totalMinor: 100 })).status).toBe(403);
  });
});

describe('result notifications', () => {
  it('notifies the requesting department when a result becomes available', async () => {
    const v = await toConsultation(staff);
    const con = await callAndStart(staff.consultation, 'CONSULTATION');
    await staff.consultation.post(`/api/tickets/${con.id}/complete`, { next: [{ departmentId: await deptId('LABORATORY'), serviceType: 'HAEMATOLOGY' }] });
    const lab = await callAndStart(staff.lab, 'LABORATORY');
    expect((await staff.lab.post(`/api/tickets/${lab.id}/result-status`, { status: 'AVAILABLE' })).status).toBe(200);
    const note = await prisma.notification.findFirst({ where: { type: 'RESULT_AVAILABLE' } });
    expect(note).not.toBeNull();
    const inbox = (await staff.consultation.get('/api/notifications')).body;
    expect(JSON.stringify(inbox)).toContain('RESULT_AVAILABLE');
    expect(v.visitId).toBeGreaterThan(0);
  });
});

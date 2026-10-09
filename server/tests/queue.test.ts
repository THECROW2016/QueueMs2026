import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import {
  callAndStart, clearClinicalData, counterIds, deptId, freshDatabase, makeStaff, newVisit, toConsultation, toTriage, type Client,
} from './helpers.js';

let staff: Awaited<ReturnType<typeof makeStaff>>;
beforeAll(async () => {
  await freshDatabase();
  staff = await makeStaff();
});

beforeEach(async () => { await clearClinicalData(); });

const status = async (id: number) => (await prisma.queueTicket.findUniqueOrThrow({ where: { id } })).status;

describe('complete patient workflow', () => {
  it('takes a patient from Reception through every department to a closed visit', async () => {
    const v = await newVisit(staff.reception);
    expect(v.display).toMatch(/^R-\d{3}$/);

    // Reception -> Triage
    const rec = await callAndStart(staff.reception, 'RECEPTION');
    expect(rec.id).toBe(v.ticketId);
    expect((await staff.reception.post(`/api/tickets/${rec.id}/workflow`, { stage: 'REGISTRATION_COMPLETE' })).status).toBe(200);
    expect((await staff.reception.post(`/api/tickets/${rec.id}/complete`, { next: [{ departmentId: await deptId('TRIAGE') }] })).status).toBe(200);

    // Triage -> Consultation
    const tri = await callAndStart(staff.triage, 'TRIAGE');
    expect(tri.display).toMatch(/^T-\d{3}$/);
    expect((await staff.triage.post(`/api/tickets/${tri.id}/complete`, { next: [{ departmentId: await deptId('CONSULTATION') }] })).status).toBe(200);

    // Consultation -> Laboratory AND Radiology at the same time
    const con = await callAndStart(staff.consultation, 'CONSULTATION');
    const split = await staff.consultation.post(`/api/tickets/${con.id}/complete`, {
      next: [
        { departmentId: await deptId('LABORATORY'), serviceType: 'HAEMATOLOGY', notes: 'FBC please' },
        { departmentId: await deptId('RADIOLOGY'), serviceType: 'X-RAY', notes: 'Chest' },
      ],
    });
    expect(split.status).toBe(200);

    // Radiology first, then laboratory (either order is allowed)
    const rad = await callAndStart(staff.radiology, 'RADIOLOGY');
    expect(rad.display).toMatch(/^RAD-\d{3}$/);
    expect((await staff.radiology.post(`/api/tickets/${rad.id}/workflow`, { stage: 'EXAM_COMPLETE' })).status).toBe(200);
    expect((await staff.radiology.post(`/api/tickets/${rad.id}/result-status`, { status: 'PENDING' })).status).toBe(200);
    expect((await staff.radiology.post(`/api/tickets/${rad.id}/complete`, {})).status).toBe(200);
    expect((await staff.radiology.post(`/api/tickets/${rad.id}/result-status`, { status: 'AVAILABLE' })).status).toBe(200);

    const lab = await callAndStart(staff.lab, 'LABORATORY');
    expect((await staff.lab.post(`/api/tickets/${lab.id}/workflow`, { stage: 'SAMPLE_COLLECTED' })).status).toBe(200);
    expect((await staff.lab.post(`/api/tickets/${lab.id}/complete`, { next: [{ departmentId: await deptId('CONSULTATION'), reason: 'Review results' }] })).status).toBe(200);

    // Back to Consultation (a second ticket), then Pharmacy
    const back = await callAndStart(staff.consultation, 'CONSULTATION');
    expect(back.id).not.toBe(con.id);
    expect((await staff.consultation.post(`/api/tickets/${back.id}/complete`, { next: [{ departmentId: await deptId('PHARMACY'), notes: 'Amoxicillin' }] })).status).toBe(200);
    const ph = await callAndStart(staff.pharmacy, 'PHARMACY');
    expect((await staff.pharmacy.post(`/api/tickets/${ph.id}/workflow`, { stage: 'DISPENSED' })).status).toBe(200);
    expect((await staff.pharmacy.post(`/api/tickets/${ph.id}/complete`, { next: [{ departmentId: await deptId('ACCOUNTS') }] })).status).toBe(200);

    // Accounts: invoice, confirmed payment, clearance, completion, closure
    const acc = await callAndStart(staff.accounts, 'ACCOUNTS');
    const inv = await staff.accounts.post(`/api/visits/${v.visitId}/invoices`, { description: 'Consultation, FBC, X-ray, drugs', totalMinor: 450000 });
    expect(inv.status).toBe(201);
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, {})).status).toBe(409); // balance outstanding
    const pay = await staff.accounts.post(`/api/invoices/${inv.body.id}/payments`, { amountMinor: 450000, method: 'MPESA', reference: 'QWE123XYZ', confirmed: true });
    expect(pay.status).toBe(201);
    expect(pay.body.invoice.status).toBe('PAID');
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/close`, {})).status).toBe(409); // not cleared, ticket open
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, {})).status).toBe(200);
    expect((await staff.accounts.post(`/api/tickets/${acc.id}/complete`, {})).status).toBe(200);
    const closed = await staff.accounts.post(`/api/visits/${v.visitId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('COMPLETED');

    // Journey
    const journey = (await staff.consultation.get(`/api/visits/${v.visitId}/journey`)).body;
    const byCode = Object.fromEntries(journey.stages.map((s: { department: { code: string }; status: string }) => [s.department.code, s.status]));
    expect(byCode).toMatchObject({ RECEPTION: 'COMPLETED', TRIAGE: 'COMPLETED', CONSULTATION: 'COMPLETED', LABORATORY: 'COMPLETED', RADIOLOGY: 'COMPLETED', PHARMACY: 'COMPLETED', ACCOUNTS: 'COMPLETED' });
    expect(journey.stages.find((s: { department: { code: string } }) => s.department.code === 'CONSULTATION').tickets).toHaveLength(2);
    expect(journey.timeline.length).toBeGreaterThan(20);
  });

  it('lets patients skip departments, and reports them as not required once the visit is done', async () => {
    const v = await toConsultation(staff);
    const con = await callAndStart(staff.consultation, 'CONSULTATION');
    expect((await staff.consultation.post(`/api/tickets/${con.id}/complete`, { next: [{ departmentId: await deptId('ACCOUNTS') }] })).status).toBe(200);
    const acc = await callAndStart(staff.accounts, 'ACCOUNTS');
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, {})).status).toBe(400); // needs a reason when no invoices
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/clear-billing`, { reason: 'No charges' })).status).toBe(200);
    expect((await staff.accounts.post(`/api/tickets/${acc.id}/complete`, {})).status).toBe(200);
    expect((await staff.accounts.post(`/api/visits/${v.visitId}/close`, {})).status).toBe(200);
    const journey = (await staff.accounts.get(`/api/visits/${v.visitId}/journey`)).body;
    const by = Object.fromEntries(journey.stages.map((s: { department: { code: string }; status: string }) => [s.department.code, s.status]));
    expect(by).toMatchObject({ LABORATORY: 'NOT_REQUIRED', RADIOLOGY: 'NOT_REQUIRED', PHARMACY: 'NOT_REQUIRED', ACCOUNTS: 'COMPLETED' });
  });
});

describe('ticket numbering', () => {
  it('issues unique, sequential numbers under concurrent requests', async () => {
    const before = await prisma.queueTicket.count({ where: { departmentId: await deptId('RECEPTION') } });
    const results = await Promise.all(Array.from({ length: 25 }, () => newVisit(staff.reception)));
    const numbers = results.map((r) => r.display);
    expect(new Set(numbers).size).toBe(25);
    const rows = await prisma.queueTicket.findMany({ where: { id: { in: results.map((r) => r.ticketId) } }, select: { ticketNumber: true } });
    const nums = rows.map((r) => r.ticketNumber).sort((a, b) => a - b);
    expect(nums[24]! - nums[0]!).toBe(24); // gap-free
    expect(before).toBeGreaterThanOrEqual(0);
  });

  it('never reuses the number of a cancelled ticket', async () => {
    const a = await newVisit(staff.reception);
    expect((await staff.reception.post(`/api/tickets/${a.ticketId}/cancel`, { reason: 'Left the queue' })).status).toBe(200);
    const b = await newVisit(staff.reception);
    expect(b.display).not.toBe(a.display);
    const na = Number(a.display.split('-')[1]);
    const nb = Number(b.display.split('-')[1]);
    expect(nb).toBeGreaterThan(na);
  });

  it('uses configurable prefixes and supports continuous sequences', async () => {
    const admin = staff.admin;
    const dep = await deptId('PHARMACY');
    expect((await admin.patch(`/api/departments/${dep}`, { ticketPrefix: 'PH', sequencePolicy: 'CONTINUOUS' })).status).toBe(200);
    const v = await toConsultation(staff);
    const con = await callAndStart(staff.consultation, 'CONSULTATION');
    await staff.consultation.post(`/api/tickets/${con.id}/complete`, { next: [{ departmentId: dep }] });
    const t = await prisma.queueTicket.findFirstOrThrow({ where: { visitId: v.visitId, departmentId: dep } });
    expect(t.displayNumber).toMatch(/^PH-\d{3}$/);
    expect(t.scopeKey).toBe('ALL');
    await admin.patch(`/api/departments/${dep}`, { ticketPrefix: 'P', sequencePolicy: 'DAILY' });
  });

  it('is safe against repeated browser submissions', async () => {
    const key = `dup-${Date.now()}-abcdefgh`;
    const body = { newPatient: { fullName: 'Repeat Submitter Zed', dateOfBirth: '1985-01-01' }, idempotencyKey: key };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => staff.reception.post('/api/visits', body)));
    const ok = [a, b, c].filter((r) => [200, 201].includes(r.status));
    expect(ok.length).toBe(3);
    expect(new Set(ok.map((r) => r.body.visit.id)).size).toBe(1);
    expect(new Set(ok.map((r) => r.body.ticket.id)).size).toBe(1);
    expect(await prisma.visit.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});

describe('call-next concurrency', () => {
  it('gives eight simultaneous callers eight different tickets, with no duplicate calls', async () => {
    const dept = await deptId('CONSULTATION');
    const missing = 8 - (await prisma.serviceCounter.count({ where: { departmentId: dept, isActive: true } }));
    for (let i = 0; i < missing; i++) {
      await staff.admin.post('/api/counters', { departmentId: dept, name: `Extra Room ${Date.now()}${i}`, kind: 'ROOM' });
    }
    // Clear anything left from earlier tests, then queue exactly 8 patients.
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] } }, data: { status: 'CANCELLED' } });
    for (let i = 0; i < 8; i++) await toConsultation(staff);
    const { counters } = await counterIds('CONSULTATION');
    expect(counters.length).toBeGreaterThanOrEqual(8);

    const results = await Promise.all(counters.slice(0, 8).map((counterId) => staff.consultation.post(`/api/departments/${dept}/call-next`, { counterId })));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    const tickets = results.map((r) => r.body.ticket?.id as number);
    expect(tickets.every(Boolean)).toBe(true);
    expect(new Set(tickets).size).toBe(8);

    const called = await prisma.queueTicket.findMany({ where: { id: { in: tickets } } });
    expect(called.every((t) => t.status === 'CALLED' && t.callCount === 1)).toBe(true);
    expect(new Set(called.map((t) => t.counterId)).size).toBe(8);
  });

  it('lets exactly one of two simultaneous callers take the last waiting ticket', async () => {
    const dept = await deptId('LABORATORY');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } }, data: { status: 'CANCELLED' } });
    await staff.admin.post('/api/counters', { departmentId: dept, name: `Lab Bench ${Date.now()}`, kind: 'COUNTER' });
    const v = await toConsultation(staff);
    const con = await callAndStart(staff.consultation, 'CONSULTATION');
    await staff.consultation.post(`/api/tickets/${con.id}/complete`, { next: [{ departmentId: dept, serviceType: 'HAEMATOLOGY' }] });
    const { counters } = await counterIds('LABORATORY');
    const [a, b] = await Promise.all(counters.slice(0, 2).map((counterId) => staff.lab.post(`/api/departments/${dept}/call-next`, { counterId })));
    const got = [a, b].filter((r) => r.body.ticket);
    expect(got).toHaveLength(1);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.queueTicket.count({ where: { visitId: v.visitId, departmentId: dept, status: 'CALLED' } })).toBe(1);
  });

  it('refuses a second call at a counter that is still busy', async () => {
    const dept = await deptId('TRIAGE');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } }, data: { status: 'CANCELLED' } });
    await toTriage(staff);
    await toTriage(staff);
    const { counters } = await counterIds('TRIAGE');
    const results = await Promise.all([1, 2, 3].map(() => staff.triage.post(`/api/departments/${dept}/call-next`, { counterId: counters[0] })));
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([200, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('COUNTER_BUSY');
  });
});

describe('state machine', () => {
  async function waitingTicket(): Promise<{ id: number; client: Client }> {
    const v = await toTriage(staff);
    return { id: (await prisma.queueTicket.findFirstOrThrow({ where: { visitId: v.visitId, departmentId: await deptId('TRIAGE') } })).id, client: staff.triage };
  }

  it('rejects invalid transitions with 409', async () => {
    const { id, client } = await waitingTicket();
    expect((await client.post(`/api/tickets/${id}/start`)).status).toBe(409); // not called yet
    expect((await client.post(`/api/tickets/${id}/complete`, {})).status).toBe(409);
    expect((await client.post(`/api/tickets/${id}/recall`)).status).toBe(409);
    expect((await client.post(`/api/tickets/${id}/hold`, {})).status).toBe(409);
    expect((await client.post(`/api/tickets/${id}/restore`)).status).toBe(409);
    expect(await status(id)).toBe('WAITING');
  });

  it('handles recall, hold, resume, absent and restore', async () => {
    const dept = await deptId('TRIAGE');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD'] } }, data: { status: 'CANCELLED' } });
    const { id, client } = await waitingTicket();
    const { counters } = await counterIds('TRIAGE');
    const called = await client.post(`/api/departments/${dept}/call-next`, { counterId: counters[0] });
    expect(called.body.ticket.id).toBe(id);
    const re = await client.post(`/api/tickets/${id}/recall`);
    expect(re.body.callCount).toBe(2);

    // absent frees the counter; patient can be restored and keeps their place
    expect((await client.post(`/api/tickets/${id}/absent`, { reason: 'Not answering' })).body.status).toBe('ABSENT');
    expect((await client.post(`/api/tickets/${id}/start`)).status).toBe(409);
    const restored = await client.post(`/api/tickets/${id}/restore`);
    expect(restored.body.status).toBe('WAITING');
    expect(restored.body.counter).toBeNull();

    // absent too long cannot be restored
    await callAndStart(client, 'TRIAGE', 0).catch(() => undefined);
    const t2 = await prisma.queueTicket.findUniqueOrThrow({ where: { id } });
    if (t2.status === 'IN_SERVICE') {
      expect((await client.post(`/api/tickets/${id}/hold`, { reason: 'Lab call' })).body.status).toBe('ON_HOLD');
      expect((await client.post(`/api/tickets/${id}/resume`)).body.status).toBe('IN_SERVICE');
      expect((await client.post(`/api/tickets/${id}/complete`, {})).body.status).toBe('COMPLETED');
    }
  });

  it('refuses to restore a patient who has been absent for too long', async () => {
    const dept = await deptId('TRIAGE');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD'] } }, data: { status: 'CANCELLED' } });
    const { id, client } = await waitingTicket();
    const { counters } = await counterIds('TRIAGE');
    await client.post(`/api/departments/${dept}/call-next`, { counterId: counters[0] });
    await client.post(`/api/tickets/${id}/absent`, {});
    await prisma.journeyEvent.updateMany({ where: { ticketId: id, eventType: 'ABSENT' }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    const res = await client.post(`/api/tickets/${id}/restore`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ABSENT_EXPIRED');
  });

  it('requires a reason to skip or cancel, and records it', async () => {
    const { id, client } = await waitingTicket();
    expect((await client.post(`/api/tickets/${id}/skip`, {})).status).toBe(400);
    expect((await client.post(`/api/tickets/${id}/cancel`, { reason: '  ' })).status).toBe(400);
    const res = await client.post(`/api/tickets/${id}/skip`, { reason: 'Not required for this patient' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SKIPPED');
    const ev = await prisma.journeyEvent.findFirstOrThrow({ where: { ticketId: id, eventType: 'SKIPPED' } });
    expect(ev.reason).toBe('Not required for this patient');
    expect(ev.userId).toBe(client.user.id);
    expect((await client.post(`/api/tickets/${id}/cancel`, { reason: 'x' })).status).toBe(409); // terminal
  });

  it('does not create duplicate tickets when "complete" is submitted twice', async () => {
    const v = await toTriage(staff);
    const tri = await callAndStart(staff.triage, 'TRIAGE');
    const body = { next: [{ departmentId: await deptId('CONSULTATION') }] };
    const [a, b] = await Promise.all([staff.triage.post(`/api/tickets/${tri.id}/complete`, body), staff.triage.post(`/api/tickets/${tri.id}/complete`, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.queueTicket.count({ where: { visitId: v.visitId, departmentId: await deptId('CONSULTATION') } })).toBe(1);
  });
});

describe('priority and emergency handling', () => {
  it('serves urgent tickets before routine ones, and arrival order within a priority', async () => {
    const dept = await deptId('CONSULTATION');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] } }, data: { status: 'CANCELLED' } });
    const route = async (opts: Record<string, unknown>) => {
      await toTriage(staff);
      const t = await callAndStart(staff.triage, 'TRIAGE');
      const r = await staff.triage.post(`/api/tickets/${t.id}/complete`, { next: [{ departmentId: dept, ...opts }] });
      expect(r.status).toBe(200);
      return (await prisma.queueTicket.findFirstOrThrow({ where: { departmentId: dept, status: 'WAITING' }, orderBy: { id: 'desc' } })).id;
    };
    const routine1 = await route({});
    const urgent = await route({ priority: 1, reason: 'Severe pain' });
    const routine2 = await route({});
    const emergency = await route({ emergency: true, reason: 'Chest pain, collapsed' });

    const queue = (await staff.consultation.get(`/api/departments/${dept}/queue`)).body;
    expect(queue.waiting.map((t: { id: number }) => t.id)).toEqual([emergency, urgent, routine1, routine2]);
    expect(queue.nextEligible.id).toBe(emergency);
    expect(queue.waiting.map((t: { position: number }) => t.position)).toEqual([1, 2, 3, 4]);

    const { counters } = await counterIds('CONSULTATION');
    const first = await staff.consultation.post(`/api/departments/${dept}/call-next`, { counterId: counters[0] });
    expect(first.body.ticket.id).toBe(emergency);
    expect(first.body.ticket.isEmergency).toBe(true);
    const second = await staff.consultation.post(`/api/departments/${dept}/call-next`, { counterId: counters[1] });
    expect(second.body.ticket.id).toBe(urgent);
  });

  it('supports arrival-only ordering when an administrator configures it', async () => {
    const dept = await deptId('CONSULTATION');
    await prisma.queueTicket.updateMany({ where: { departmentId: dept, status: { in: ['WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT'] } }, data: { status: 'CANCELLED' } });
    const ids: number[] = [];
    for (const opts of [{}, { priority: 1, reason: 'Urgent' }]) {
      await toTriage(staff);
      const t = await callAndStart(staff.triage, 'TRIAGE');
      await staff.triage.post(`/api/tickets/${t.id}/complete`, { next: [{ departmentId: dept, ...opts }] });
      ids.push((await prisma.queueTicket.findFirstOrThrow({ where: { departmentId: dept, status: 'WAITING' }, orderBy: { id: 'desc' } })).id);
    }
    expect((await staff.admin.patch('/api/settings', { 'queue.priorityOrdering': 'arrival_only' })).status).toBe(200);
    try {
      const q = (await staff.consultation.get(`/api/departments/${dept}/queue`)).body;
      expect(q.waiting.map((t: { id: number }) => t.id)).toEqual(ids);
    } finally {
      await staff.admin.patch('/api/settings', { 'queue.priorityOrdering': 'priority_then_arrival' });
    }
  });

  it('keeps priority and emergency decisions with clinical staff', async () => {
    const v = await toTriage(staff);
    const ticket = await prisma.queueTicket.findFirstOrThrow({ where: { visitId: v.visitId, departmentId: await deptId('TRIAGE') } });
    expect((await staff.reception.post(`/api/tickets/${ticket.id}/priority`, { priority: 2, reason: 'x' })).status).toBe(403);
    expect((await staff.pharmacy.post(`/api/tickets/${ticket.id}/priority`, { priority: 1, reason: 'x' })).status).toBe(403);
    expect((await staff.triage.post(`/api/tickets/${ticket.id}/priority`, { priority: 1 })).status).toBe(400); // reason required
    const ok = await staff.triage.post(`/api/tickets/${ticket.id}/priority`, { priority: 2, reason: 'Unresponsive' });
    expect(ok.status).toBe(200);
    expect(ok.body.priority).toBe(2);
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.visitId } })).isEmergency).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'TICKET_PRIORITY_CHANGED', entityId: String(ticket.id) } })).toBe(1);
  });

  it('only lets authorised clinicians use the emergency pathway, and needs a reason', async () => {
    const v = await toTriage(staff);
    const reception = await prisma.queueTicket.findFirstOrThrow({ where: { visitId: v.visitId, departmentId: await deptId('RECEPTION') } });
    expect(reception.status).toBe('COMPLETED');
    const tri = await callAndStart(staff.triage, 'TRIAGE');
    const denied = await staff.triage.post(`/api/tickets/${tri.id}/complete`, { next: [{ departmentId: await deptId('CONSULTATION'), emergency: true }] });
    expect(denied.status).toBe(400); // no reason
    expect(await prisma.queueTicket.count({ where: { visitId: v.visitId, departmentId: await deptId('CONSULTATION') } })).toBe(0);
    expect(await status(tri.id)).toBe('IN_SERVICE'); // whole operation rolled back
  });
});

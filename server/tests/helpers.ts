import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { seedReferenceData } from '../src/services/bootstrap.service.js';
import { createUser } from '../src/services/users.service.js';

export const PASSWORD = 'Str0ng-Test-Pass!';
export const app = createApp();

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Deletes everything except reference data (roles, permissions, departments, counters, rules, settings). */
export async function resetOperationalData() {
  for (const table of [
    'NotificationRead', 'Notification', 'OutboxEvent', 'Payment', 'Invoice', 'JourneyEvent', 'ClinicalReferral',
    'QueueTicket', 'QueueSequence', 'Visit', 'Patient', 'AuditLog', 'PasswordResetToken', 'Session',
    'UserDepartmentAssignment', 'UserRole', 'User',
  ]) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
}

/** Clears queue/visit/patient data between tests but keeps users and sessions (so signed-in clients stay valid). */
export async function clearClinicalData() {
  for (const table of ['NotificationRead', 'Notification', 'OutboxEvent', 'Payment', 'Invoice', 'JourneyEvent', 'ClinicalReferral', 'QueueTicket', 'QueueSequence', 'Visit', 'Patient']) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
  await prisma.$executeRawUnsafe("DELETE FROM `SystemSetting` WHERE `key` LIKE 'seq.%'");
}

export async function freshDatabase() {
  await resetOperationalData();
  await seedReferenceData();
}

export const deptByCode = async (code: string) => prisma.department.findUniqueOrThrow({ where: { code } });

export async function makeUser(roleCodes: string[], departmentCodes: string[] = [], extra: { username?: string; password?: string } = {}) {
  const depts = await prisma.department.findMany({ where: { code: { in: departmentCodes } } });
  const username = extra.username ?? `u_${uniq()}`;
  const user = await createUser({
    username, fullName: `Test ${username}`, password: extra.password ?? PASSWORD, roleCodes,
    departmentIds: depts.map((d) => d.id),
  });
  return { ...user, password: extra.password ?? PASSWORD };
}

export interface Client {
  user: { id: number; username: string; permissions: string[]; departmentIds: number[] };
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
  agent: ReturnType<typeof request.agent>;
}

export async function signIn(username: string, password = PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  const h = (t: request.Test) => t.set('x-csrf-token', csrf);
  return {
    user: res.body.user, csrf, agent,
    get: (url) => agent.get(url),
    post: (url, body = {}) => h(agent.post(url)).send(body),
    patch: (url, body = {}) => h(agent.patch(url)).send(body),
    put: (url, body = {}) => h(agent.put(url)).send(body),
    del: (url) => h(agent.delete(url)),
  };
}

export async function userClient(roleCodes: string[], departmentCodes: string[] = []) {
  const u = await makeUser(roleCodes, departmentCodes);
  return signIn(u.username);
}

/** A standard cast: one user per department plus an administrator. */
export async function makeStaff() {
  const [admin, reception, triage, consultation, lab, radiology, pharmacy, accounts] = await Promise.all([
    userClient(['SYSTEM_ADMIN']),
    userClient(['RECEPTION'], ['RECEPTION']),
    userClient(['TRIAGE'], ['TRIAGE']),
    userClient(['CONSULTATION'], ['CONSULTATION']),
    userClient(['LABORATORY'], ['LABORATORY']),
    userClient(['RADIOLOGY'], ['RADIOLOGY']),
    userClient(['PHARMACY'], ['PHARMACY']),
    userClient(['ACCOUNTS'], ['ACCOUNTS']),
  ]);
  return { admin, reception, triage, consultation, lab, radiology, pharmacy, accounts };
}

/* ---------------------------- Workflow helpers ---------------------------- */

let seq = 0;
export const randomName = () => `Test Patient ${Date.now().toString(36)}${seq++}`;

export async function newVisit(reception: Client, overrides: Record<string, unknown> = {}) {
  const res = await reception.post('/api/visits', {
    newPatient: { fullName: randomName(), dateOfBirth: '1990-05-17', sex: 'FEMALE', phone: `07${Math.floor(10000000 + Math.random() * 89999999)}` },
    idempotencyKey: `key-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`createVisit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { visitId: res.body.visit.id as number, ticketId: res.body.ticket.id as number, display: res.body.ticket.displayNumber as string, patientId: res.body.visit.patientId as number };
}

export const counterIds = async (code: string) => {
  const dept = await deptByCode(code);
  const rows = await prisma.serviceCounter.findMany({ where: { departmentId: dept.id, isActive: true }, orderBy: { id: 'asc' } });
  return { deptId: dept.id, counters: rows.map((c) => c.id) };
};

/** Call the next ticket in a department from its first free counter, then start it. */
export async function callAndStart(client: Client, code: string, counterIndex = 0) {
  const { deptId, counters } = await counterIds(code);
  const called = await client.post(`/api/departments/${deptId}/call-next`, { counterId: counters[counterIndex] });
  if (called.status !== 200 || !called.body.ticket) throw new Error(`call-next failed: ${called.status} ${JSON.stringify(called.body)}`);
  const id = called.body.ticket.id as number;
  const started = await client.post(`/api/tickets/${id}/start`);
  if (started.status !== 200) throw new Error(`start failed: ${started.status} ${JSON.stringify(started.body)}`);
  return { id, display: called.body.ticket.displayNumber as string };
}

export const deptId = async (code: string) => (await deptByCode(code)).id;

/** Walk a visit's Reception ticket through to Triage, so tests can start deeper in the flow. */
export async function toTriage(staff: Awaited<ReturnType<typeof makeStaff>>) {
  const v = await newVisit(staff.reception);
  const rec = await callAndStart(staff.reception, 'RECEPTION');
  const done = await staff.reception.post(`/api/tickets/${rec.id}/complete`, { next: [{ departmentId: await deptId('TRIAGE') }] });
  if (done.status !== 200) throw new Error(`reception complete failed ${done.status} ${JSON.stringify(done.body)}`);
  return v;
}

export async function toConsultation(staff: Awaited<ReturnType<typeof makeStaff>>) {
  const v = await toTriage(staff);
  const tri = await callAndStart(staff.triage, 'TRIAGE');
  const done = await staff.triage.post(`/api/tickets/${tri.id}/complete`, { next: [{ departmentId: await deptId('CONSULTATION') }] });
  if (done.status !== 200) throw new Error(`triage complete failed ${done.status} ${JSON.stringify(done.body)}`);
  return v;
}

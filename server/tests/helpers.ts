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

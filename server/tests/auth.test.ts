import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { PASSWORD, app, freshDatabase, makeUser, signIn, userClient } from './helpers.js';

beforeAll(freshDatabase);

describe('authentication', () => {
  it('logs in with valid credentials and returns a CSRF token but no secrets', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const res = await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeTruthy();
    expect(res.body.user.username).toBe(u.username);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/i);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/hqms_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores only a hash of the session token and an Argon2id password hash', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const res = await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD });
    const token = /hqms_sid=([^;]+)/.exec(res.headers['set-cookie']![0]!)![1]!;
    const sessions = await prisma.session.findMany({ where: { userId: u.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).not.toBe(token);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects an invalid password and an unknown user with the same message', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const bad = await request(app).post('/api/auth/login').send({ username: u.username, password: 'wrong-password-1' });
    const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody-here', password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('blocks a disabled user, including a user with an open session', async () => {
    const admin = await userClient(['SYSTEM_ADMIN']);
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const live = await signIn(u.username);
    expect((await live.get('/api/auth/me')).body.user.username).toBe(u.username);

    const off = await admin.patch(`/api/users/${u.id}`, { isActive: false });
    expect(off.status).toBe(200);
    expect((await live.get('/api/auth/me')).body.user).toBeNull();
    const again = await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD });
    expect(again.status).toBe(401);
  });

  it('expires idle sessions and sessions past their absolute lifetime', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const c = await signIn(u.username);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { idleExpiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/api/auth/me')).body.user).toBeNull();

    const c2 = await signIn(u.username);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await c2.get('/api/auth/me')).body.user).toBeNull();
    expect((await c2.get('/api/departments')).status).toBe(401);
  });

  it('locks the account after repeated failures, then accepts the right password after the lockout ends', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ username: u.username, password: 'wrong-password-1' });
    }
    const locked = await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD });
    expect(locked.status).toBe(423);
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const ok = await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('logs out and invalidates the session', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const c = await signIn(u.username);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/departments')).status).toBe(401);
  });

  it('audits login success, failure and logout', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    await request(app).post('/api/auth/login').send({ username: u.username, password: 'wrong-password-1' });
    const c = await signIn(u.username);
    await c.post('/api/auth/logout');
    const actions = (await prisma.auditLog.findMany({ where: { userId: u.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_SUCCESS', 'LOGOUT']));
  });

  it('limits sign-in attempts per IP', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    process.env.LOGIN_RATE_LIMIT = '3';
    const { createApp } = await import('../src/app.js');
    const limited = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await request(limited).post('/api/auth/login').send({ username: 'nobody', password: 'wrong-password-1' })).status);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
    process.env.LOGIN_RATE_LIMIT = '1000';
    vi.resetModules();
  });
});

describe('CSRF and unauthenticated access', () => {
  it('rejects unauthenticated API calls', async () => {
    for (const url of ['/api/users', '/api/departments', '/api/settings', '/api/audit-logs']) {
      expect((await request(app).get(url)).status).toBe(401);
    }
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const u = await makeUser(['SYSTEM_ADMIN']);
    const c = await signIn(u.username);
    const res = await c.agent.post('/api/counters').send({ departmentId: 1, name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/i);
  });

  it('rejects a cross-site Origin', async () => {
    const u = await makeUser(['SYSTEM_ADMIN']);
    const c = await signIn(u.username);
    const res = await c.post('/api/counters', { departmentId: 1, name: 'X' }).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('password management', () => {
  it('enforces password rules on change and signs out other sessions', async () => {
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const a = await signIn(u.username);
    const b = await signIn(u.username);
    expect((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    expect((await a.post('/api/auth/change-password', { currentPassword: 'nope-nope-nope', newPassword: 'Another-Good-Pass1' })).status).toBe(400);
    expect((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Another-Good-Pass1' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).body.user).not.toBeNull();
    expect((await b.get('/api/auth/me')).body.user).toBeNull();
    expect((await request(app).post('/api/auth/login').send({ username: u.username, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ username: u.username, password: 'Another-Good-Pass1' })).status).toBe(200);
  });

  it('supports an admin-issued, single-use, expiring reset token', async () => {
    const admin = await userClient(['SYSTEM_ADMIN']);
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const issued = await admin.post(`/api/users/${u.id}/reset-password`);
    expect(issued.status).toBe(200);
    const { token } = issued.body;
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.tokenHash).not.toBe(token);

    const weak = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const ok = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Fresh-Secret-Pass9' });
    expect(ok.status).toBe(200);
    const reuse = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Fresh-Secret-Pass8' });
    expect(reuse.status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ username: u.username, password: 'Fresh-Secret-Pass9' })).status).toBe(200);

    const issued2 = await admin.post(`/api/users/${u.id}/reset-password`);
    await prisma.passwordResetToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post('/api/auth/reset-password').send({ token: issued2.body.token, newPassword: 'Fresh-Secret-Pass7' });
    expect(expired.status).toBe(400);
  });
});

describe('user management and permissions', () => {
  it('lets only administrators manage users', async () => {
    const reception = await userClient(['RECEPTION'], ['RECEPTION']);
    const admin = await userClient(['SYSTEM_ADMIN']);
    expect((await reception.get('/api/users')).status).toBe(403);
    expect((await reception.post('/api/users', { username: 'x1x1x1', fullName: 'X', password: PASSWORD, roleCodes: ['RECEPTION'] })).status).toBe(403);
    expect((await reception.get('/api/audit-logs')).status).toBe(403);
    expect((await reception.patch('/api/settings', { 'hospital.name': 'Hacked' })).status).toBe(403);
    expect((await reception.put('/api/routing-rules', { fromDepartmentId: 1, toDepartmentId: 2 })).status).toBe(403);
    expect((await reception.post('/api/counters', { departmentId: 1, name: 'Z' })).status).toBe(403);
    const list = await admin.get('/api/users');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);
  });

  it('creates users with roles and multiple department assignments', async () => {
    const admin = await userClient(['SYSTEM_ADMIN']);
    const depts = (await admin.get('/api/departments')).body as Array<{ id: number; code: string }>;
    const lab = depts.find((d) => d.code === 'LABORATORY')!;
    const rad = depts.find((d) => d.code === 'RADIOLOGY')!;
    const res = await admin.post('/api/users', {
      username: `multi_${Date.now()}`, fullName: 'Multi Dept', password: PASSWORD, roleCodes: ['LABORATORY'], departmentIds: [lab.id, rad.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.departments.map((d: { code: string }) => d.code).sort()).toEqual(['LABORATORY', 'RADIOLOGY']);
    expect(res.body.roles[0].code).toBe('LABORATORY');
  });

  it('rejects weak passwords and duplicate usernames', async () => {
    const admin = await userClient(['SYSTEM_ADMIN']);
    const base = { fullName: 'Dup', roleCodes: ['RECEPTION'] };
    expect((await admin.post('/api/users', { ...base, username: 'weakpw_user', password: 'password123' })).status).toBe(400);
    const name = `dup_${Date.now()}`;
    expect((await admin.post('/api/users', { ...base, username: name, password: PASSWORD })).status).toBe(201);
    expect((await admin.post('/api/users', { ...base, username: name, password: PASSWORD })).status).toBe(409);
  });

  it('never removes the last active administrator', async () => {
    await prisma.$executeRawUnsafe('DELETE FROM `User` WHERE id IN (SELECT userId FROM (SELECT ur.userId FROM `UserRole` ur JOIN `Role` r ON r.id = ur.roleId WHERE r.code = \'SYSTEM_ADMIN\') x)');
    const admin = await userClient(['SYSTEM_ADMIN']);
    const self = admin.user.id;
    const res = await admin.patch(`/api/users/${self}`, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
    const res2 = await admin.patch(`/api/users/${self}`, { roleCodes: ['RECEPTION'] });
    expect(res2.status).toBe(409);
  });

  it('applies role and department changes immediately by ending sessions', async () => {
    const admin = await userClient(['SYSTEM_ADMIN']);
    const u = await makeUser(['RECEPTION'], ['RECEPTION']);
    const c = await signIn(u.username);
    expect((await admin.patch(`/api/users/${u.id}`, { roleCodes: ['TRIAGE'] })).status).toBe(200);
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
    const c2 = await signIn(u.username);
    expect(c2.user.permissions).toContain('queue.priority');
  });
});

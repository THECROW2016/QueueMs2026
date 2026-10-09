import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { startRealtime, type Realtime } from '../src/sockets/index.js';
import { localDateKey } from '../src/utils/time.js';
import { app, callAndStart, clearClinicalData, counterIds, deptId, freshDatabase, makeStaff, newVisit, randomName, toTriage, type Client } from './helpers.js';

let staff: Awaited<ReturnType<typeof makeStaff>>;
let server: http.Server;
let rt: Realtime;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  await freshDatabase();
  staff = await makeStaff();
  server = http.createServer(app);
  rt = startRealtime(server, { pollMs: 100 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  sockets.forEach((s) => s.close());
  await rt.stop();
  await new Promise((r) => server.close(r));
});
beforeEach(async () => { await clearClinicalData(); });

/** The session cookie from a signed-in supertest agent, for the socket handshake. */
async function cookieFor(client: Client) {
  const jar = (client.agent as unknown as { jar: { getCookies: (o: unknown) => Array<{ name: string; value: string }> } }).jar;
  const c = jar.getCookies({ domain: '127.0.0.1', path: '/', script: false, secure: false } as never).find((x) => x.name === 'hqms_sid');
  return c ? `hqms_sid=${c.value}` : '';
}
async function staffSocket(client: Client) {
  const cookie = await cookieFor(client);
  const s = connect(url, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  await new Promise<void>((res, rej) => { s.once('connect', () => res()); s.once('connect_error', rej); });
  return s;
}
const subscribe = (s: Socket, dept: number) => new Promise<{ ok: boolean; error?: string }>((r) => s.emit('subscribe', dept, r));
const once = <T>(s: Socket, ev: string, ms = 3000) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms); s.once(ev, (d: T) => { clearTimeout(t); res(d); }); });

describe('public display', () => {
  it('is available without signing in and exposes no patient information', async () => {
    const name = randomName();
    const v = await newVisit(staff.reception, { newPatient: { fullName: name, dateOfBirth: '1980-01-01', sex: 'MALE', phone: '0799123456', nationalId: '12345678' } });
    await callAndStart(staff.reception, 'RECEPTION');
    const res = await request(app).get('/api/public/display');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const secret of [name, '0799123456', '12345678', 'MRN-', '1980-01-01']) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/visitId|patient|notes|fullName/i);
    expect(res.body.nowServing[0]).toMatchObject({ displayNumber: v.display, department: 'Reception' });
    expect(res.body.nowServing[0].callKey).toBe(`${v.ticketId}:1`);
    expect(res.body.departments.find((d: { code: string }) => d.code === 'RECEPTION').waiting).toBe(0);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('counts waiting tickets and lists the next numbers', async () => {
    await newVisit(staff.reception); const b = await newVisit(staff.reception);
    const res = await request(app).get('/api/public/display');
    const rec = res.body.departments.find((d: { code: string }) => d.code === 'RECEPTION');
    expect(rec.waiting).toBe(2);
    expect(rec.nextUp).toHaveLength(2);
    expect(rec.nextUp).toContain(b.display);
  });

  it('serves OpenAPI documentation', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/departments/{id}/call-next']).toBeDefined();
  });
});

describe('sockets', () => {
  it('rejects connections without a valid session', async () => {
    const s = connect(url, { transports: ['websocket'], reconnection: false });
    sockets.push(s);
    const err = await new Promise<Error>((r) => s.once('connect_error', r));
    expect(err.message).toBe('UNAUTHENTICATED');
  });

  it('only lets staff subscribe to departments they are authorised for', async () => {
    const s = await staffSocket(staff.triage);
    expect(await subscribe(s, await deptId('TRIAGE'))).toEqual({ ok: true });
    expect(await subscribe(s, await deptId('PHARMACY'))).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await subscribe(s, -4)).toEqual({ ok: false, error: 'BAD_REQUEST' });
  });

  it('pushes queue changes only to subscribed departments, and public calls to the display', async () => {
    const triageSocket = await staffSocket(staff.triage);
    const labSocket = await staffSocket(staff.lab);
    await subscribe(triageSocket, await deptId('TRIAGE'));
    await subscribe(labSocket, await deptId('LABORATORY'));
    const leaked: unknown[] = [];
    labSocket.on('queue.changed', (m) => leaked.push(m));

    const display = connect(`${url}/display`, { transports: ['websocket'], reconnection: false });
    sockets.push(display);
    await new Promise<void>((r) => display.once('connect', () => r()));

    const waitTriage = once<{ displayNumber: string; departmentId: number }>(triageSocket, 'queue.changed');
    const waitCall = once<{ displayNumber: string; callKey: string }>(display, 'display.call');
    await toTriage(staff);
    const called = await callAndStart(staff.triage, 'TRIAGE');
    const change = await waitTriage;
    expect(change.departmentId).toBe(await deptId('TRIAGE'));
    const call = await waitCall;
    expect(call.displayNumber).toBeTruthy();
    expect(JSON.stringify(call)).not.toMatch(/patient|visitId|fullName/i);
    void called;
    await rt.flush();
    expect(leaked).toHaveLength(0);
  });

  it('disconnects a socket after its session is revoked', async () => {
    const fresh = (await import('./helpers.js')).userClient;
    const c = await fresh(['TRIAGE'], ['TRIAGE']);
    const s = await staffSocket(c);
    const closed = new Promise<string>((r) => s.once('disconnect', r));
    await prisma.session.deleteMany({ where: { userId: c.user.id } });
    expect(await subscribe(s, await deptId('TRIAGE'))).toMatchObject({ ok: false, error: 'SESSION_EXPIRED' });
    expect(await closed).toBeTruthy();
  });

  it('marks outbox rows dispatched exactly once', async () => {
    await newVisit(staff.reception);
    await rt.flush();
    expect(await prisma.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(0);
    expect(await rt.flush()).toBe(0);
  });
});

describe('reports', () => {
  const today = () => localDateKey();

  it('computes metrics from real tickets and excludes cancelled visits by default', async () => {
    const a = await newVisit(staff.reception);
    const b = await newVisit(staff.reception);
    const rec = await callAndStart(staff.reception, 'RECEPTION');
    await staff.reception.post(`/api/tickets/${rec.id}/complete`, { next: [{ departmentId: await deptId('TRIAGE') }] });
    await staff.reception.post(`/api/visits/${b.visitId}/cancel`, { reason: 'Left before service' });

    const q = `from=${today()}&to=${today()}`;
    const res = await staff.admin.get(`/api/reports/summary?${q}`);
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ registrations: 2, visitsOpened: 1, visitsCancelled: 0, visitsIncomplete: 1 });
    const reception = res.body.departments.find((d: { code: string }) => d.code === 'RECEPTION');
    expect(reception).toMatchObject({ ticketsIssued: 1, completed: 1 });
    expect(reception.avgWaitSeconds).toBeGreaterThanOrEqual(0);
    expect(reception.avgServiceSeconds).toBeGreaterThanOrEqual(0);

    const withCancelled = (await staff.admin.get(`/api/reports/summary?${q}&includeCancelled=true`)).body;
    expect(withCancelled.totals.visitsOpened).toBe(2);
    expect(withCancelled.totals.visitsCancelled).toBe(1);
    expect(a.visitId).not.toBe(b.visitId);
    expect(res.body.daily).toHaveLength(1);
  });

  it('filters by department and validates the date range', async () => {
    await newVisit(staff.reception);
    const t = today();
    const triageOnly = (await staff.admin.get(`/api/reports/departments?from=${t}&to=${t}&departmentId=${await deptId('TRIAGE')}`)).body.rows;
    expect(triageOnly).toHaveLength(1);
    expect(triageOnly[0].ticketsIssued).toBe(0);
    expect((await staff.admin.get('/api/reports/summary?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await staff.admin.get('/api/reports/summary?from=2020-01-01&to=2026-01-01')).status).toBe(400);
  });

  it('exports CSV with a header row, audits the export, and requires permission', async () => {
    await newVisit(staff.reception);
    const t = today();
    const res = await staff.admin.get(`/api/reports/export?report=departments&from=${t}&to=${t}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Department,Tickets issued');
    expect(res.text).toContain('Reception,1');
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED' } })).toBeGreaterThan(0);
    expect((await staff.reception.get(`/api/reports/export?from=${t}&to=${t}`)).status).toBe(403);
    expect((await staff.reception.get(`/api/reports/summary?from=${t}&to=${t}`)).status).toBe(403);
  });

  it('serves the live dashboard from the database to administrators only', async () => {
    await newVisit(staff.reception); await newVisit(staff.reception);
    const res = await staff.admin.get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.activeVisits).toBe(2);
    expect(res.body.departments.find((d: { code: string }) => d.code === 'RECEPTION').waiting).toBe(2);
    expect((await staff.lab.get('/api/dashboard')).status).toBe(403);
    expect(counterIds).toBeDefined();
  });
});

import type { Request } from 'express';
import { prisma, transact, type Tx } from '../db.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { audit } from './audit.service.js';
import { canSeeAllDepartments, type AuthUser } from './access.service.js';
import { nextCounter } from './sequence.service.js';

export interface PatientInput {
  fullName: string;
  dateOfBirth?: string | null; // YYYY-MM-DD
  sex?: 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN';
  phone?: string | null;
  nationalId?: string | null;
  address?: string | null;
}

/** Order-insensitive normalised name used for search and duplicate detection. */
export const nameKey = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

const normPhone = (p?: string | null) => (p ? p.replace(/[^\d+]/g, '') : null) || null;
const toDate = (s?: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dobString = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function ageYears(dob: Date | null, at = new Date()): number | null {
  if (!dob) return null;
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const m = at.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

type PatientRow = Awaited<ReturnType<typeof prisma.patient.findFirstOrThrow>>;

export const serializePatient = (p: PatientRow) => ({
  id: p.id, mrn: p.mrn, fullName: p.fullName, dateOfBirth: dobString(p.dateOfBirth), age: ageYears(p.dateOfBirth),
  sex: p.sex, phone: p.phone, nationalId: p.nationalId, address: p.address, createdAt: p.createdAt,
});

/** Minimal card used inside queue lists for staff who may view patient details. */
export const patientCard = (p: PatientRow) => ({
  id: p.id, mrn: p.mrn, fullName: p.fullName, age: ageYears(p.dateOfBirth), sex: p.sex,
});

const maskPhone = (p: string | null) => (p && p.length > 4 ? `${'•'.repeat(p.length - 3)}${p.slice(-3)}` : p);

export async function findDuplicates(db: Pick<Tx, 'patient'>, input: PatientInput) {
  const key = nameKey(input.fullName);
  const dob = toDate(input.dateOfBirth);
  const phone = normPhone(input.phone);
  const or: Array<Record<string, unknown>> = [];
  if (dob) or.push({ nameKey: key, dateOfBirth: dob });
  if (input.nationalId) or.push({ nationalId: input.nationalId });
  if (phone) or.push({ nameKey: key, phone });
  if (!dob && !phone) or.push({ nameKey: key }); // name alone is weak, but nothing else is known
  const rows = await db.patient.findMany({ where: { OR: or }, take: 5, orderBy: { id: 'asc' } });
  return rows.map((p) => ({ id: p.id, mrn: p.mrn, fullName: p.fullName, dateOfBirth: dobString(p.dateOfBirth), sex: p.sex, phone: maskPhone(p.phone) }));
}

export async function createPatientTx(tx: Tx, input: PatientInput, actorId: number) {
  const n = await nextCounter(tx, 'seq.mrn');
  return tx.patient.create({
    data: {
      mrn: `MRN-${String(n).padStart(6, '0')}`, fullName: input.fullName.trim(), nameKey: nameKey(input.fullName),
      dateOfBirth: toDate(input.dateOfBirth), sex: input.sex ?? 'UNKNOWN', phone: normPhone(input.phone),
      nationalId: input.nationalId?.trim() || null, address: input.address?.trim() || null, createdById: actorId,
    },
  });
}

export async function registerPatient(user: AuthUser, input: PatientInput, opts: { confirmDuplicate?: boolean }, req?: Request) {
  if (!opts.confirmDuplicate) {
    const candidates = await findDuplicates(prisma, input);
    if (candidates.length) throw conflict('A similar patient record already exists. Check it before creating a new one.', 'DUPLICATE_SUSPECTED', { candidates });
  }
  const patient = await transact(async (tx) => {
    const p = await createPatientTx(tx, input, user.id);
    await audit({ userId: user.id, action: 'PATIENT_REGISTERED', entityType: 'Patient', entityId: p.id, metadata: { duplicateConfirmed: !!opts.confirmDuplicate }, req }, tx);
    return p;
  });
  return serializePatient(patient);
}

export async function searchPatients(user: AuthUser, q: { q: string; page: number; pageSize: number }, req?: Request) {
  const term = q.q.trim();
  const tokens = nameKey(term).split(' ').filter(Boolean);
  const digits = term.replace(/\D/g, '');
  const or: Array<Record<string, unknown>> = [];
  if (/^mrn/i.test(term) || /^\d{1,6}$/.test(term)) or.push({ mrn: { contains: term.toUpperCase().replace(/^MRN-?/, 'MRN-') } });
  if (digits.length >= 5) or.push({ phone: { contains: digits } }, { nationalId: { contains: term } });
  if (tokens.length) or.push({ AND: tokens.map((t) => ({ nameKey: { contains: t } })) });
  const where = { isTest: false, OR: or };
  const [total, rows] = await Promise.all([
    prisma.patient.count({ where }),
    prisma.patient.findMany({ where, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  await audit({ userId: user.id, action: 'PATIENT_SEARCHED', entityType: 'Patient', metadata: { results: total }, req });
  return {
    total, page: q.page, pageSize: q.pageSize,
    items: rows.map((p) => ({ id: p.id, mrn: p.mrn, fullName: p.fullName, dateOfBirth: dobString(p.dateOfBirth), age: ageYears(p.dateOfBirth), sex: p.sex, phone: maskPhone(p.phone) })),
  };
}

/** Staff may open a patient if they register patients, are administrators, or have the patient in their departments. */
export async function assertPatientAccess(user: AuthUser, patientId: number) {
  if (!user.permissions.has('patient.view')) throw forbidden();
  if (canSeeAllDepartments(user) || user.permissions.has('patient.register')) return;
  const seen = await prisma.queueTicket.findFirst({
    where: { departmentId: { in: user.departmentIds }, visit: { patientId } }, select: { id: true },
  });
  if (!seen) throw forbidden('You do not have access to this patient.');
}

export async function getPatient(user: AuthUser, id: number, req?: Request) {
  const p = await prisma.patient.findUnique({ where: { id } });
  if (!p) throw notFound('Patient');
  await assertPatientAccess(user, id);
  await audit({ userId: user.id, action: 'PATIENT_VIEWED', entityType: 'Patient', entityId: id, req });
  const visits = user.permissions.has('visit.view')
    ? await prisma.visit.findMany({ where: { patientId: id }, orderBy: { openedAt: 'desc' }, take: 50, select: { id: true, visitNumber: true, status: true, isEmergency: true, openedAt: true, closedAt: true } })
    : [];
  return { ...serializePatient(p), visits };
}

export async function updatePatient(user: AuthUser, id: number, input: Partial<PatientInput>, req?: Request) {
  const existing = await prisma.patient.findUnique({ where: { id } });
  if (!existing) throw notFound('Patient');
  await assertPatientAccess(user, id);
  const updated = await prisma.patient.update({
    where: { id },
    data: {
      fullName: input.fullName?.trim(), nameKey: input.fullName ? nameKey(input.fullName) : undefined,
      dateOfBirth: input.dateOfBirth === undefined ? undefined : toDate(input.dateOfBirth),
      sex: input.sex, phone: input.phone === undefined ? undefined : normPhone(input.phone),
      nationalId: input.nationalId === undefined ? undefined : input.nationalId?.trim() || null,
      address: input.address === undefined ? undefined : input.address?.trim() || null,
    },
  });
  await audit({ userId: user.id, action: 'PATIENT_UPDATED', entityType: 'Patient', entityId: id, metadata: { fields: Object.keys(input) }, req });
  return serializePatient(updated);
}

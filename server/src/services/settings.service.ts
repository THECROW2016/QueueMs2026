import { z } from 'zod';
import { prisma } from '../db.js';
import { DEFAULT_SETTINGS } from '../domain/constants.js';
import { badRequest } from '../utils/errors.js';
import { parseJson, toJson } from '../utils/misc.js';
import { audit } from './audit.service.js';

const validators: Record<string, z.ZodTypeAny> = {
  'hospital.name': z.string().trim().min(1).max(120),
  'hospital.logoUrl': z.string().trim().max(500).refine((v) => v === '' || /^(https?:\/\/|\/)/.test(v), 'Must be an http(s) URL or a path'),
  'display.instructions': z.string().trim().max(400),
  'display.showClock': z.boolean(),
  'display.recentCount': z.number().int().min(1).max(12),
  'display.language': z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Use a language tag such as en-KE'),
  'display.speechRate': z.number().min(0.5).max(1.5),
  'queue.priorityOrdering': z.enum(['priority_then_arrival', 'arrival_only']),
  'queue.absentGraceMinutes': z.number().int().min(1).max(600),
  'ticket.footer': z.string().trim().max(300),
};

export async function getSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.systemSetting.findMany();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in validators) out[r.key] = parseJson(r.value, DEFAULT_SETTINGS[r.key]);
  return out;
}

export async function getSetting<T>(key: string): Promise<T> {
  return (await getSettings())[key] as T;
}

export async function updateSettings(changes: Record<string, unknown>, actorId: number, req?: import('express').Request) {
  const entries = Object.entries(changes);
  if (!entries.length) throw badRequest('No settings supplied.');
  for (const [key, value] of entries) {
    const v = validators[key];
    if (!v) throw badRequest(`Unknown setting "${key}".`);
    const r = v.safeParse(value);
    if (!r.success) throw badRequest(`Invalid value for ${key}: ${r.error.issues[0]?.message}`);
  }
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of entries) {
      await tx.systemSetting.upsert({
        where: { key }, update: { value: toJson(value), updatedById: actorId }, create: { key, value: toJson(value), updatedById: actorId },
      });
    }
    await audit({ userId: actorId, action: 'SETTINGS_UPDATED', entityType: 'SystemSetting', metadata: { keys: entries.map(([k]) => k) }, req }, tx);
  });
  return getSettings();
}

/** Settings that are safe to show on the unauthenticated public display. */
export async function publicDisplaySettings() {
  const s = await getSettings();
  return {
    hospitalName: s['hospital.name'] as string,
    logoUrl: s['hospital.logoUrl'] as string,
    instructions: s['display.instructions'] as string,
    showClock: s['display.showClock'] as boolean,
    recentCount: s['display.recentCount'] as number,
    language: s['display.language'] as string,
    speechRate: s['display.speechRate'] as number,
  };
}

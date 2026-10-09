import { prisma } from '../db.js';
import {
  DEFAULT_RULES, DEFAULT_SETTINGS, DEPARTMENTS, PERMISSIONS, ROLES,
} from '../domain/constants.js';
import { toJson } from '../utils/misc.js';

/**
 * Idempotently creates permissions, roles, departments, counters, routing rules and
 * default settings. Never touches users, patients, visits or tickets, and never
 * overwrites values an administrator has already changed (settings, names, prefixes).
 */
export async function seedReferenceData() {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.code, p.id]));

  for (const [code, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: def.name, description: def.description },
      create: { code, name: def.name, description: def.description },
    });
    // Role permissions follow the code definition (roles are system-defined).
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: [...new Set(def.permissions)].map((p) => {
        const permissionId = permId.get(p);
        if (!permissionId) throw new Error(`Unknown permission ${p} in role ${code}`);
        return { roleId: role.id, permissionId };
      }),
    });
  }

  for (const [i, d] of DEPARTMENTS.entries()) {
    const dept = await prisma.department.upsert({
      where: { code: d.code },
      update: {},
      create: {
        code: d.code, name: d.name, ticketPrefix: d.prefix, sortOrder: i + 1, isClinical: d.clinical,
        workflowStages: toJson(d.stages), serviceTypes: d.serviceTypes ? toJson(d.serviceTypes) : null,
      },
    });
    for (const name of d.counters) {
      await prisma.serviceCounter.upsert({
        where: { departmentId_name: { departmentId: dept.id, name } },
        update: {},
        create: { departmentId: dept.id, name, kind: d.counterKind },
      });
    }
  }

  const depts = await prisma.department.findMany();
  const byCode = new Map(depts.map((d) => [d.code, d.id]));
  for (const [from, to, opts] of DEFAULT_RULES) {
    const fromDepartmentId = byCode.get(from)!;
    const toDepartmentId = byCode.get(to)!;
    await prisma.routingRule.upsert({
      where: { fromDepartmentId_toDepartmentId: { fromDepartmentId, toDepartmentId } },
      update: {},
      create: {
        fromDepartmentId, toDepartmentId,
        requiresReason: opts?.requiresReason ?? false, emergencyOnly: opts?.emergencyOnly ?? false,
      },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: toJson(value) } });
  }
}

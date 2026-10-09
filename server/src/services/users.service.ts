import { prisma, transact } from '../db.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { randomToken, sha256 } from '../utils/misc.js';
import { assertStrongPassword, hashPassword } from './password.js';
import { audit } from './audit.service.js';

const include = {
  roles: { include: { role: true } },
  departments: { include: { department: true } },
} as const;

type UserRow = Awaited<ReturnType<typeof prisma.user.findFirstOrThrow<{ include: typeof include }>>>;

/** The only shape in which users leave the API. Never includes the password hash. */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lockedUntil: u.lockedUntil,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
    departments: u.departments.map((d) => ({ id: d.departmentId, code: d.department.code, name: d.department.name })),
  };
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  email?: string | null;
  password: string;
  roleCodes: string[];
  departmentIds?: number[];
  mustChangePassword?: boolean;
}

async function resolveRoles(codes: string[]) {
  const roles = await prisma.role.findMany({ where: { code: { in: codes } } });
  if (roles.length !== new Set(codes).size) throw badRequest('One or more roles do not exist.');
  return roles;
}

async function resolveDepartments(ids: number[]) {
  const depts = await prisma.department.findMany({ where: { id: { in: ids } } });
  if (depts.length !== new Set(ids).size) throw badRequest('One or more departments do not exist.');
}

export async function createUser(input: CreateUserInput, actorId?: number, req?: import('express').Request) {
  const username = input.username.trim();
  assertStrongPassword(input.password, { username });
  if (!input.roleCodes.length) throw badRequest('Assign at least one role.');
  const roles = await resolveRoles(input.roleCodes);
  await resolveDepartments(input.departmentIds ?? []);
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await transact(async (tx) => {
      const created = await tx.user.create({
        data: {
          username, fullName: input.fullName.trim(), email: input.email?.trim() || null, passwordHash,
          mustChangePassword: input.mustChangePassword ?? false,
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
          departments: { create: [...new Set(input.departmentIds ?? [])].map((departmentId) => ({ departmentId })) },
        },
        include,
      });
      await audit({ userId: actorId ?? null, action: 'USER_CREATED', entityType: 'User', entityId: created.id,
        metadata: { username, roles: input.roleCodes, departmentIds: input.departmentIds ?? [] }, req }, tx);
      return created;
    });
    return publicUser(user);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw conflict('That username or email is already in use.', 'DUPLICATE_USER');
    throw err;
  }
}

export async function listUsers(params: { page: number; pageSize: number; search?: string; isActive?: boolean }) {
  const where = {
    ...(params.isActive === undefined ? {} : { isActive: params.isActive }),
    ...(params.search
      ? { OR: [{ username: { contains: params.search } }, { fullName: { contains: params.search } }, { email: { contains: params.search } }] }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, include, orderBy: { id: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
  ]);
  return { items: rows.map(publicUser), total, page: params.page, pageSize: params.pageSize };
}

export async function getUser(id: number) {
  const u = await prisma.user.findUnique({ where: { id }, include });
  if (!u) throw notFound('User');
  return publicUser(u);
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string | null;
  roleCodes?: string[];
  departmentIds?: number[];
  isActive?: boolean;
}

export async function updateUser(id: number, input: UpdateUserInput, actor: { id: number }, req?: import('express').Request) {
  const existing = await prisma.user.findUnique({ where: { id }, include });
  if (!existing) throw notFound('User');

  const roles = input.roleCodes ? await resolveRoles(input.roleCodes) : null;
  if (input.departmentIds) await resolveDepartments(input.departmentIds);
  if (roles && !roles.length) throw badRequest('Assign at least one role.');

  // Never leave the system without an active administrator.
  const isAdminNow = existing.roles.some((r) => r.role.code === 'SYSTEM_ADMIN') && existing.isActive;
  const willBeAdmin = (roles ? roles.some((r) => r.code === 'SYSTEM_ADMIN') : isAdminNow) && (input.isActive ?? existing.isActive);
  if (isAdminNow && !willBeAdmin) {
    const others = await prisma.user.count({
      where: { id: { not: id }, isActive: true, roles: { some: { role: { code: 'SYSTEM_ADMIN' } } } },
    });
    if (others === 0) throw conflict('At least one active System Administrator must remain.', 'LAST_ADMIN');
  }

  try {
    const updated = await transact(async (tx) => {
      if (roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
      }
      if (input.departmentIds) {
        await tx.userDepartmentAssignment.deleteMany({ where: { userId: id } });
        await tx.userDepartmentAssignment.createMany({
          data: [...new Set(input.departmentIds)].map((departmentId) => ({ userId: id, departmentId })),
        });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          fullName: input.fullName?.trim(),
          email: input.email === undefined ? undefined : input.email?.trim() || null,
          isActive: input.isActive,
          // Reactivation clears any lockout.
          ...(input.isActive ? { failedLogins: 0, lockedUntil: null } : {}),
        },
        include,
      });
      // Permission or status changes take effect immediately: drop sessions.
      if (roles || input.departmentIds || input.isActive === false) await tx.session.deleteMany({ where: { userId: id } });
      await audit({ userId: actor.id, action: input.isActive === false ? 'USER_DEACTIVATED' : input.isActive === true && !existing.isActive ? 'USER_REACTIVATED' : 'USER_UPDATED',
        entityType: 'User', entityId: id, metadata: { ...input }, req }, tx);
      return u;
    });
    return publicUser(updated);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw conflict('That email is already in use.', 'DUPLICATE_USER');
    throw err;
  }
}

/** Admin issues a one-time reset token (shown once). Delivery (email/SMS) is out of band. */
export async function createPasswordReset(userId: number, actorId: number, req?: import('express').Request) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('User');
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.RESET_TOKEN_MINUTES * 60_000);
  await transact(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt, createdById: actorId } });
    await audit({ userId: actorId, action: 'PASSWORD_RESET_ISSUED', entityType: 'User', entityId: userId, req }, tx);
  });
  return { token, expiresAt };
}

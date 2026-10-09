import type { Request } from 'express';
import { prisma, transact } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest } from '../utils/errors.js';
import { clientIp, randomToken, sha256 } from '../utils/misc.js';
import { audit } from './audit.service.js';
import { loadAuthUser, type AuthUser } from './access.service.js';
import { DUMMY_HASH_PROMISE, assertStrongPassword, hashPassword, verifyPassword } from './password.js';

const GENERIC_FAIL = 'Incorrect username or password.';

export interface LoginResult {
  token: string;
  csrfToken: string;
  user: AuthUser;
  expiresAt: Date;
}

export async function login(
  input: { username: string; password: string; requireAdmin?: boolean },
  req?: Request,
): Promise<LoginResult> {
  const username = input.username.trim();
  const user = await prisma.user.findUnique({ where: { username } });
  const now = new Date();

  if (user?.lockedUntil && user.lockedUntil > now) {
    await audit({ userId: user.id, action: 'LOGIN_BLOCKED_LOCKED', entityType: 'User', entityId: user.id, req });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'This account is temporarily locked after too many failed attempts. Try again later or ask an administrator.');
  }

  const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const ok = await verifyPassword(hash, input.password);

  if (!user || !ok || !user.isActive) {
    if (user && user.isActive) {
      const failed = user.failedLogins + 1;
      const lock = failed >= config.LOGIN_MAX_FAILED;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + config.LOCKOUT_MINUTES * 60_000) : null },
      });
      await audit({ userId: user.id, action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', entityType: 'User', entityId: user.id, req });
    } else {
      await audit({ userId: user?.id ?? null, action: user ? 'LOGIN_FAILED_INACTIVE' : 'LOGIN_FAILED_UNKNOWN_USER', metadata: { username: username.slice(0, 60) }, req });
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC_FAIL);
  }

  const authUser = await loadAuthUser(user.id);
  if (!authUser) throw new AppError(401, 'INVALID_CREDENTIALS', GENERIC_FAIL);
  if (input.requireAdmin && !authUser.isAdmin) {
    throw new AppError(403, 'NOT_ADMIN', 'This account does not have administrator access. Choose "User" to sign in.');
  }

  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(now.getTime() + config.SESSION_IDLE_MINUTES * 60_000);
  const absolute = new Date(now.getTime() + config.SESSION_ABSOLUTE_HOURS * 3_600_000);
  await transact(async (tx) => {
    await tx.session.create({
      data: {
        id: sha256(token), userId: user.id, csrfToken,
        ipAddress: req ? clientIp(req)?.slice(0, 64) : undefined, userAgent: req?.get('user-agent')?.slice(0, 255),
        idleExpiresAt: expiresAt, absoluteExpiresAt: absolute,
      },
    });
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
    await tx.session.deleteMany({ where: { OR: [{ idleExpiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }] } });
    await audit({ userId: user.id, action: 'LOGIN_SUCCESS', entityType: 'User', entityId: user.id, req }, tx);
  });
  return { token, csrfToken, user: authUser, expiresAt: absolute };
}

/** Resolves a cookie token to a live session and slides the idle timeout. */
export async function resolveSession(token: string) {
  const id = sha256(token);
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s) return null;
  const now = new Date();
  if (s.idleExpiresAt < now || s.absoluteExpiresAt < now) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  const user = await loadAuthUser(s.userId);
  if (!user) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  // Slide the idle window at most once a minute to avoid a write per request.
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    const idle = new Date(Math.min(now.getTime() + config.SESSION_IDLE_MINUTES * 60_000, s.absoluteExpiresAt.getTime()));
    await prisma.session.update({ where: { id }, data: { lastSeenAt: now, idleExpiresAt: idle } }).catch(() => undefined);
  }
  return { user, session: { id, csrfToken: s.csrfToken } };
}

/** Like resolveSession but read-only: it never slides the idle timeout (used to re-check long-lived sockets). */
export async function peekSession(token: string) {
  const s = await prisma.session.findUnique({ where: { id: sha256(token) } });
  const now = new Date();
  if (!s || s.idleExpiresAt < now || s.absoluteExpiresAt < now) return null;
  const user = await loadAuthUser(s.userId);
  return user ? { user, sessionId: s.id } : null;
}

export async function logout(token: string, userId: number, req?: Request) {
  await prisma.session.deleteMany({ where: { id: sha256(token) } });
  await audit({ userId, action: 'LOGOUT', entityType: 'User', entityId: userId, req });
}

export async function changePassword(
  user: AuthUser, currentSessionId: string, input: { currentPassword: string; newPassword: string }, req?: Request,
) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(row.passwordHash, input.currentPassword))) throw badRequest('Current password is incorrect.');
  assertStrongPassword(input.newPassword, { username: user.username });
  if (input.newPassword === input.currentPassword) throw badRequest('Choose a password different from the current one.');
  const passwordHash = await hashPassword(input.newPassword);
  await transact(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    // Sign out every other device.
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: currentSessionId } } });
    await audit({ userId: user.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: user.id, req }, tx);
  });
}

export async function resetPasswordWithToken(input: { token: string; newPassword: string }, req?: Request) {
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) }, include: { user: true } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date() || !rec.user.isActive) {
    throw badRequest('This reset link is invalid or has expired.');
  }
  assertStrongPassword(input.newPassword, { username: rec.user.username });
  const passwordHash = await hashPassword(input.newPassword);
  await transact(async (tx) => {
    // Single use: claim the token atomically.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw badRequest('This reset link is invalid or has expired.');
    await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    await tx.session.deleteMany({ where: { userId: rec.userId } });
    await audit({ userId: rec.userId, action: 'PASSWORD_RESET_COMPLETED', entityType: 'User', entityId: rec.userId, req }, tx);
  });
}

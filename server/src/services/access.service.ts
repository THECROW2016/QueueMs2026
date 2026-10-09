import { prisma } from '../db.js';
import { ADMIN_ROLE } from '../domain/constants.js';
import { forbidden } from '../utils/errors.js';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  isAdmin: boolean;
  roles: string[];
  permissions: Set<string>;
  departmentIds: number[];
  mustChangePassword: boolean;
}

export interface SessionInfo {
  id: string;
  csrfToken: string;
}

/** Loads a user's roles, permissions and department assignments in one query. */
export async function loadAuthUser(userId: number): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      departments: { where: { department: { isActive: true } } },
    },
  });
  if (!u || !u.isActive) return null;
  const roles = u.roles.map((r) => r.role.code);
  const permissions = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    isAdmin: roles.includes(ADMIN_ROLE),
    roles,
    permissions,
    departmentIds: u.departments.map((d) => d.departmentId),
    mustChangePassword: u.mustChangePassword,
  };
}

export const can = (user: AuthUser, permission: string) => user.permissions.has(permission);

/**
 * Departments the user may see queues for. Administrators with the hospital-wide
 * dashboard permission see all; everyone else sees only their assignments.
 */
export function canSeeAllDepartments(user: AuthUser) {
  return user.permissions.has('dashboard.admin');
}

export function canAccessDepartment(user: AuthUser, departmentId: number, permission: string): boolean {
  if (!user.permissions.has(permission)) return false;
  if (user.departmentIds.includes(departmentId)) return true;
  // Hospital-wide read-only access for administrators.
  return permission === 'queue.view' && canSeeAllDepartments(user);
}

/** Throws 403 unless the user holds `permission` for this department. Never trust client IDs. */
export function assertDepartmentPermission(user: AuthUser, departmentId: number, permission: string) {
  if (!canAccessDepartment(user, departmentId, permission)) {
    throw forbidden('You are not authorised for this department or action.');
  }
}

export function assertPermission(user: AuthUser, permission: string) {
  if (!user.permissions.has(permission)) throw forbidden();
}

/** Department IDs where the user holds `permission` (used to scope list queries). */
export function departmentsWith(user: AuthUser, permission: string, allDepartmentIds: number[]): number[] {
  if (!user.permissions.has(permission)) return [];
  if (permission === 'queue.view' && canSeeAllDepartments(user)) return allDepartmentIds;
  return user.departmentIds.filter((d) => allDepartmentIds.includes(d));
}

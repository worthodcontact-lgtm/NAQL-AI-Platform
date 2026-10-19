import { AuthUser } from "./routes.js";
import { Permission, PLATFORM_ROLES, roleHasPermission } from "./permissions.js";

/** Kept for compatibility with existing imports. */
export const PLATFORM_STAFF_ROLES = [...PLATFORM_ROLES];

/** True when the actor holds any platform administration role. */
export function hasRole(user: AuthUser, roles: string[]): boolean {
  return user.roles.some((role) => roles.includes(role));
}

/**
 * Platform staff status comes from `User.platformRole` only. Organization
 * ownership and membership roles can never make someone platform staff.
 *
 * The `admin` scope is also required: holding a platform role must not turn an
 * ordinary application token into a cross-tenant business credential. Staff who
 * genuinely need the platform override must sign in through `/admin/login`.
 */
export function isPlatformStaff(user: AuthUser): boolean {
  return user.scope === "admin" && Boolean(user.platformRole);
}

/** Permission check for platform roles, restricted to administration sessions. */
export function can(user: AuthUser, permission: Permission): boolean {
  return user.scope === "admin" && roleHasPermission(user.platformRole, permission);
}

/** Organization-level manager check (company domain, not platform authority). */
export function isCompanyManager(user: AuthUser): boolean {
  return hasRole(user, ["ORG_ADMIN", "COMPANY_MANAGER", "OWNER"]);
}

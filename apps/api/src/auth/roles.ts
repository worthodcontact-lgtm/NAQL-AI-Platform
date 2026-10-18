import { AuthUser } from "./routes.js";

export const PLATFORM_STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "REVIEWER", "DATA_OPERATOR"];

export function hasRole(user: AuthUser, roles: string[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

export function isPlatformStaff(user: AuthUser): boolean {
  return hasRole(user, PLATFORM_STAFF_ROLES);
}

export function isCompanyManager(user: AuthUser): boolean {
  return hasRole(user, ["ORG_ADMIN", "COMPANY_MANAGER", "OWNER"]);
}

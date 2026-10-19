/**
 * Platform administration roles and permissions.
 *
 * These are platform-level roles. They are deliberately NOT organization
 * memberships: owning a company or holding ORG_ADMIN in an organization never
 * grants any permission in this file.
 *
 * The matrix below is the single source of truth for the API. The web console
 * mirrors it for display only; every request is authorized here as well.
 */

export const PLATFORM_ROLES = ["SUPER_ADMIN", "ADMIN", "REVIEWER", "SUPPORT"] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PERMISSIONS = [
  "admin.access",
  "metrics.read",
  "users.read",
  "users.manage",
  "users.roles",
  "companies.read",
  "companies.verify",
  "shipments.read",
  "shipments.manage",
  "bookings.read",
  "bookings.manage",
  "rfqs.read",
  "quotations.read",
  "ports.read",
  "ports.manage",
  "reports.read",
  "audit.read",
  "settings.read",
  "settings.manage"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Only `users.roles` and `settings.manage` are Super-Admin-only. Everything
 * else is assigned to the lowest role that legitimately needs it.
 */
const MATRIX: Record<PlatformRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: [
    "admin.access",
    "metrics.read",
    "users.read",
    "users.manage",
    "companies.read",
    "companies.verify",
    "shipments.read",
    "shipments.manage",
    "bookings.read",
    "bookings.manage",
    "rfqs.read",
    "quotations.read",
    "ports.read",
    "ports.manage",
    "reports.read",
    "audit.read",
    "settings.read"
  ],
  REVIEWER: [
    "admin.access",
    "metrics.read",
    "users.read",
    "companies.read",
    "companies.verify",
    "reports.read",
    "audit.read",
    "settings.read"
  ],
  SUPPORT: [
    "admin.access",
    "metrics.read",
    "users.read",
    "companies.read",
    "shipments.read",
    "bookings.read",
    "rfqs.read",
    "quotations.read",
    "ports.read",
    "settings.read"
  ]
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function roleHasPermission(role: PlatformRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[role].includes(permission);
}

/** Full permission list for the role, used by the admin session endpoint. */
export function permissionsFor(role: PlatformRole | null | undefined): Permission[] {
  if (!role) return [];
  return [...MATRIX[role]];
}

export function isSuperAdmin(role: PlatformRole | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

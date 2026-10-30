import { FastifyReply, FastifyRequest } from "fastify";
import { getAuthUser, AuthUser } from "./routes.js";
import { OrganizationAccountType, TradeRole } from "./account.js";

/**
 * Company workspace roles and permissions.
 *
 * These are organization-membership roles. They are deliberately separate from
 * the platform roles in `permissions.ts`: a company owner has no administration
 * authority, and a platform administrator has no automatic company membership.
 *
 * Legacy role names are kept as aliases so existing memberships and tokens keep
 * working after the migration. New invitations use the explicit names.
 */
export const COMPANY_ROLES = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "OPERATIONS_MANAGER",
  "LOGISTICS_OPERATOR",
  "FINANCE_USER",
  "DOCUMENTS_USER",
  "VIEWER"
] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_PERMISSIONS = [
  "company.members.read",
  "company.members.manage",
  "company.settings.read",
  "company.settings.manage",
  "company.documents.read",
  "company.documents.manage",
  "shipments.read",
  "shipments.create",
  "shipments.update",
  "shipments.delete",
  "shipments.parties.manage",
  "shipments.documents.read",
  "shipments.documents.upload",
  "shipments.financials.read",
  "shipments.financials.manage",
  "rfqs.read",
  "rfqs.create",
  "quotes.submit",
  "quotes.accept",
  "bookings.read",
  "bookings.confirm",
  "bookings.tracking",
  "costs.read",
  "costs.manage",
  "reports.read"
] as const;

export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number];

/** Legacy membership values and their explicit equivalent. */
const ROLE_ALIASES: Record<string, CompanyRole> = {
  ORG_ADMIN: "COMPANY_OWNER",
  OWNER: "COMPANY_OWNER",
  COMPANY_OWNER: "COMPANY_OWNER",
  COMPANY_MANAGER: "COMPANY_ADMIN",
  COMPANY_ADMIN: "COMPANY_ADMIN",
  OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
  LOGISTICS_OPERATOR: "LOGISTICS_OPERATOR",
  FINANCE_USER: "FINANCE_USER",
  DOCUMENTS_USER: "DOCUMENTS_USER",
  VIEWER: "VIEWER"
};

const READ_BASELINE: readonly CompanyPermission[] = [
  "company.settings.read",
  "shipments.read",
  "shipments.documents.read",
  "rfqs.read",
  "bookings.read"
];

const MATRIX: Record<CompanyRole, readonly CompanyPermission[]> = {
  COMPANY_OWNER: COMPANY_PERMISSIONS,
  COMPANY_ADMIN: COMPANY_PERMISSIONS,
  OPERATIONS_MANAGER: [
    ...READ_BASELINE,
    "company.documents.read",
    "shipments.create",
    "shipments.update",
    "shipments.parties.manage",
    "shipments.documents.upload",
    "shipments.financials.read",
    "rfqs.create",
    "quotes.submit",
    "quotes.accept",
    "bookings.confirm",
    "bookings.tracking",
    "costs.read",
    "reports.read"
  ],
  LOGISTICS_OPERATOR: [
    ...READ_BASELINE,
    "shipments.update",
    "shipments.documents.upload",
    "shipments.financials.read",
    "quotes.submit",
    "bookings.confirm",
    "bookings.tracking",
    "costs.read"
  ],
  FINANCE_USER: [
    ...READ_BASELINE,
    "company.documents.read",
    "shipments.financials.read",
    "shipments.financials.manage",
    "quotes.accept",
    "costs.read",
    "costs.manage",
    "reports.read"
  ],
  DOCUMENTS_USER: [
    ...READ_BASELINE,
    "company.documents.read",
    "company.documents.manage",
    "shipments.documents.upload"
  ],
  VIEWER: [...READ_BASELINE, "reports.read"]
};

export function normalizeCompanyRole(value: string): CompanyRole | null {
  return ROLE_ALIASES[value] ?? null;
}

/** Unique explicit roles for a principal. Unknown values are ignored. */
export function companyRolesFor(roles: readonly string[]): CompanyRole[] {
  const output = new Set<CompanyRole>();
  for (const role of roles) {
    const normalized = normalizeCompanyRole(role);
    if (normalized) output.add(normalized);
  }
  return [...output];
}

export function companyPermissionsFor(roles: readonly string[]): CompanyPermission[] {
  const output = new Set<CompanyPermission>();
  for (const role of companyRolesFor(roles)) {
    for (const permission of MATRIX[role]) output.add(permission);
  }
  return [...output];
}

export function hasCompanyPermission(user: AuthUser, permission: CompanyPermission): boolean {
  // An administration token must never act as a company credential, even when
  // the administrator's account also belongs to an organization.
  if (user.scope !== "app") return false;
  return companyPermissionsFor(user.roles).includes(permission);
}

export function isCompanyOwner(user: AuthUser): boolean {
  return user.scope === "app" && companyRolesFor(user.roles).includes("COMPANY_OWNER");
}

export function isCompanyAdmin(user: AuthUser): boolean {
  const roles = companyRolesFor(user.roles);
  return user.scope === "app" && (roles.includes("COMPANY_OWNER") || roles.includes("COMPANY_ADMIN"));
}

/**
 * True only for an application session whose current organization is
 * classified as a logistics service provider. Customer accounts retain their
 * ordinary company roles but cannot use provider-only RFQ routes until they
 * explicitly create a provider profile.
 */
export function isProviderOrganization(user: AuthUser): boolean {
  return user.scope === "app" && user.accountType === "provider";
}

export function requireProviderOrganization() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getAuthUser(request);
    if (user.scope !== "app") {
      return reply.code(403).send({
        error: "Provider workspace session required",
        code: "provider_session_required"
      });
    }
    if (!isProviderOrganization(user)) {
      return reply.code(403).send({
        error: "A provider organization profile is required",
        code: "provider_account_required"
      });
    }
  };
}

/** True when the role may be granted by the actor's roles. */
export function canAssignCompanyRole(actorRoles: readonly string[], targetRole: string): boolean {
  const target = normalizeCompanyRole(targetRole);
  if (!target) return false;
  const actor = companyRolesFor(actorRoles);
  if (actor.includes("COMPANY_OWNER")) return true;
  if (!actor.includes("COMPANY_ADMIN")) return false;
  // Admins cannot create owners or peers that could later demote them.
  return target !== "COMPANY_OWNER" && target !== "COMPANY_ADMIN";
}

/**
 * Guard for business routes that require a company permission.
 *
 * It rejects administration sessions explicitly. Authorization is always
 * enforced here on the server; the web UI only hides controls for usability.
 */
export function requireCompanyPermission(permission: CompanyPermission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getAuthUser(request);
    if (user.scope !== "app") {
      return reply.code(403).send({
        error: "Company workspace session required",
        code: "company_session_required"
      });
    }
    if (!hasCompanyPermission(user, permission)) {
      return reply.code(403).send({
        error: "Insufficient company permission",
        code: "insufficient_company_permission",
        permission
      });
    }
  };
}

export interface CompanyContext {
  organizationId: string;
  accountType: OrganizationAccountType;
  tradeRole: TradeRole | null;
  isProvider: boolean;
  roles: CompanyRole[];
  permissions: CompanyPermission[];
  isOwner: boolean;
  isAdmin: boolean;
}

export function companyContext(user: AuthUser): CompanyContext {
  const roles = companyRolesFor(user.roles);
  return {
    organizationId: user.organizationId,
    accountType: user.accountType,
    tradeRole: user.tradeRole,
    isProvider: isProviderOrganization(user),
    roles,
    permissions: companyPermissionsFor(user.roles),
    isOwner: roles.includes("COMPANY_OWNER"),
    isAdmin: roles.includes("COMPANY_OWNER") || roles.includes("COMPANY_ADMIN")
  };
}

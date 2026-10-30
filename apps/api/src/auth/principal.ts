import { prisma } from "../db.js";
import { isPlatformRole, PlatformRole } from "./permissions.js";
import {
  normalizeOrganizationAccountType,
  normalizeTradeRole,
  OrganizationAccountType,
  TradeRole
} from "./account.js";

/**
 * The authoritative actor record for an authenticated request.
 *
 * It is rebuilt from PostgreSQL on every authenticated request (when a database
 * is configured) so that suspensions, platform-role changes, account
 * classification changes and session revocations take effect immediately
 * instead of waiting for a token to expire.
 */
export interface Principal {
  id: string;
  email: string;
  displayName: string;
  organizationId: string | null;
  /** Organization-membership roles only. Never platform roles. */
  roles: string[];
  /** Customer/provider classification of the current organization. */
  accountType: OrganizationAccountType;
  /** importer | exporter | both | null for the current organization. */
  tradeRole: TradeRole | null;
  platformRole: PlatformRole | null;
  status: "active" | "suspended";
  sessionVersion: number;
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  if (!prisma || !userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      organizationId: true,
      status: true,
      platformRole: true,
      sessionVersion: true,
      organization: {
        select: {
          accountType: true,
          tradeRole: true
        }
      }
    }
  });

  if (!user) return null;

  // Only roles in the user's primary organization are exposed. Memberships in
  // other organizations must never widen authority in the current tenant.
  const memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      organizationId: user.organizationId ?? "__none__",
      // Invitations do not grant authority until the invitee accepts them.
      status: "active"
    },
    select: { role: true }
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    organizationId: user.organizationId,
    roles: memberships.map((membership) => membership.role),
    accountType: normalizeOrganizationAccountType(user.organization?.accountType),
    tradeRole: normalizeTradeRole(user.organization?.tradeRole),
    platformRole: isPlatformRole(user.platformRole) ? user.platformRole : null,
    status: user.status === "suspended" ? "suspended" : "active",
    sessionVersion: user.sessionVersion
  };
}

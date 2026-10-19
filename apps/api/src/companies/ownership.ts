import { prisma } from "../db.js";
import { devCompanies } from "./routes.js";

/**
 * Authoritative check that an organization owns a company.
 *
 * This is the single source of truth for company ownership and must be used for
 * every provider-side action (submitting quotes, confirming bookings). It never
 * trusts a client-supplied organization id.
 */
export async function organizationOwnsCompany(
  organizationId: string,
  companyId: string
): Promise<boolean> {
  if (!organizationId || !companyId) return false;

  if (prisma) {
    const company = await (prisma as any).company.findUnique({ where: { id: companyId } });
    return Boolean(company && company.organizationId === organizationId);
  }

  return devCompanies.some((c) => c.id === companyId && c.organizationId === organizationId);
}

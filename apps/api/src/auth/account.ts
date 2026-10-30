/**
 * Organization account classification.
 *
 * This is deliberately separate from platform roles (`permissions.ts`) and
 * company workspace roles (`company.ts`). An account type never grants a role;
 * it records whether an organization is primarily a customer/importer/exporter
 * or a logistics service provider. The API still authorises every action from
 * the authenticated principal, membership and company ownership.
 */

export const ORGANIZATION_ACCOUNT_TYPES = ["customer", "provider"] as const;
export type OrganizationAccountType = (typeof ORGANIZATION_ACCOUNT_TYPES)[number];

export const TRADE_ROLES = ["importer", "exporter", "both"] as const;
export type TradeRole = (typeof TRADE_ROLES)[number];

/**
 * Maps client input to the two persisted account types.
 *
 * Unknown values are intentionally treated as `customer`, never as a privilege
 * elevation. `company` is accepted as a legacy/UI synonym for `provider`.
 */
export function normalizeOrganizationAccountType(value: unknown): OrganizationAccountType {
  return value === "provider" || value === "company" ? "provider" : "customer";
}

export function normalizeTradeRole(value: unknown): TradeRole | null {
  return TRADE_ROLES.includes(value as TradeRole) ? (value as TradeRole) : null;
}

export function isProviderAccountType(value: unknown): boolean {
  return value === "provider";
}

/**
 * A provider profile is a Company record with a logistics category. The legacy
 * `importer_exporter` company type describes the customer's trade activity and
 * is never eligible to quote, receive provider RFQs or access the provider
 * marketplace.
 */
export function isProviderCompanyType(type: unknown): boolean {
  return typeof type === "string" && type !== "importer_exporter";
}

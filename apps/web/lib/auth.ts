export type OrganizationAccountType = "customer" | "provider";
export type TradeRole = "importer" | "exporter" | "both";

export interface TokenUser {
  id: string;
  email: string;
  displayName?: string;
  organizationId?: string;
  roles: string[];
  /** Customer/provider classification, never a role or platform authority. */
  accountType?: OrganizationAccountType;
  /** importer | exporter | both | null for the organization's own trade. */
  tradeRole?: TradeRole | null;
  /** Platform authority, independent of organization membership. */
  platformRole?: string | null;
  /** `admin` only on tokens issued by the administration login. */
  scope?: "app" | "admin";
}

export const AUTH_EVENT = "naql-auth-change";

export const PLATFORM_STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "REVIEWER", "SUPPORT"];

/**
 * Decodes a JWT payload without verifying it.
 *
 * This is presentation-only: it must never be treated as an authorization
 * check. All authorization decisions are enforced by the API.
 */
export function decodeToken(token: string): TokenUser | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    // JWT uses base64url; atob needs standard base64 with correct padding.
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const json = decodeURIComponent(
      binary
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const data = JSON.parse(json);
    return {
      id: String(data?.sub ?? data?.id ?? ""),
      email: String(data?.email ?? ""),
      displayName: data?.displayName,
      organizationId: data?.organizationId ? String(data.organizationId) : undefined,
      roles: Array.isArray(data?.roles) ? data.roles.map(String) : [],
      accountType:
        data?.accountType === "provider"
          ? "provider"
          : data?.accountType === "customer"
            ? "customer"
            : undefined,
      tradeRole:
        data?.tradeRole === "importer" || data?.tradeRole === "exporter" || data?.tradeRole === "both"
          ? data.tradeRole
          : null,
      platformRole: data?.platformRole ? String(data.platformRole) : null,
      scope: data?.scope === "admin" ? "admin" : "app"
    };
  } catch {
    return null;
  }
}

export function getTokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getUserFromToken(): TokenUser | null {
  const token = getTokenFromStorage();
  return token ? decodeToken(token) : null;
}

export function setSession(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("token", token);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("token");
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** Keeps every open tab in sync when the session changes in another tab. */
export function subscribeAuth(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === "token") callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTH_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTH_EVENT, callback);
  };
}

export function isPlatformStaffRole(user: TokenUser | null | undefined): boolean {
  return Boolean(user?.platformRole);
}

export type AccountKind = "guest" | "customer" | "provider" | "staff";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  guest: "زائر",
  customer: "حساب عميل (مستورد / مصدّر)",
  provider: "حساب مزوّد خدمة لوجستية",
  staff: "موظف منصة NAQL AI"
};

export const ACCOUNT_KIND_PORTAL: Record<AccountKind, string> = {
  guest: "الموقع العام",
  customer: "بوابة العملاء",
  provider: "بوابة مزوّدي الخدمة",
  staff: "بوابة إدارة NAQL AI"
};

export const ACCOUNT_KIND_TONE: Record<AccountKind, string> = {
  guest: "bg-slate-100 text-slate-600",
  customer: "bg-primary/10 text-primary",
  provider: "bg-teal/15 text-teal-dark",
  staff: "bg-warning/15 text-warning"
};

/** Badge tones intended for the dark navy sidebar background. */
export const ACCOUNT_KIND_TONE_DARK: Record<AccountKind, string> = {
  guest: "bg-white/10 text-slate-200",
  customer: "bg-primary text-white",
  provider: "bg-teal text-navy",
  staff: "bg-warning text-white"
};

export const ACCOUNT_TYPE_LABEL: Record<OrganizationAccountType, string> = {
  customer: "عميل / مستورد / مصدّر",
  provider: "مزوّد خدمة لوجستية"
};

export const TRADE_ROLE_LABEL: Record<TradeRole, string> = {
  importer: "مستورد",
  exporter: "مصدّر",
  both: "مستورد ومصدّر"
};

export function tradeRoleLabel(value: string | null | undefined): string | null {
  if (value === "importer" || value === "exporter" || value === "both") {
    return TRADE_ROLE_LABEL[value];
  }
  return null;
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "مدير منصة أعلى",
  ADMIN: "مدير منصة",
  REVIEWER: "مراجع تحقق",
  SUPPORT: "دعم فني",
  DATA_OPERATOR: "مشغّل جمع بيانات (قديم)",
  COMPANY_OWNER: "مالك الشركة",
  COMPANY_ADMIN: "مدير الشركة",
  OPERATIONS_MANAGER: "مدير عمليات",
  LOGISTICS_OPERATOR: "مشغّل لوجستيات",
  FINANCE_USER: "مسؤول مالي",
  DOCUMENTS_USER: "مسؤول مستندات",
  ORG_ADMIN: "مالك الشركة (دور قديم)",
  COMPANY_MANAGER: "مدير شركة (دور قديم)",
  OWNER: "مالك (دور قديم)",
  VIEWER: "مطّلع"
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export function describeRoles(roles: string[]): string {
  if (!roles.length) return "بدون دور";
  return roles.map(roleLabel).join(" · ");
}

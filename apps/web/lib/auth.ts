export interface TokenUser {
  id: string;
  email: string;
  displayName?: string;
  organizationId?: string;
  roles: string[];
}

export const AUTH_EVENT = "naql-auth-change";

export const PLATFORM_STAFF_ROLES = ["SUPER_ADMIN", "ADMIN", "REVIEWER", "DATA_OPERATOR"];

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
      roles: Array.isArray(data?.roles) ? data.roles.map(String) : []
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

export function isPlatformStaffRole(roles: string[]): boolean {
  return roles.some((r) => PLATFORM_STAFF_ROLES.includes(r));
}

export type AccountKind = "guest" | "customer" | "company" | "staff";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  guest: "زائر",
  customer: "حساب عميل (مستورد / مصدّر)",
  company: "حساب شركة (مزوّد خدمة)",
  staff: "موظف منصة NAQL AI"
};

export const ACCOUNT_KIND_PORTAL: Record<AccountKind, string> = {
  guest: "الموقع العام",
  customer: "بوابة العملاء",
  company: "بوابة الشركات",
  staff: "بوابة إدارة NAQL AI"
};

export const ACCOUNT_KIND_TONE: Record<AccountKind, string> = {
  guest: "bg-slate-100 text-slate-600",
  customer: "bg-primary/10 text-primary",
  company: "bg-teal/15 text-teal-dark",
  staff: "bg-warning/15 text-warning"
};

/** Badge tones intended for the dark navy sidebar background. */
export const ACCOUNT_KIND_TONE_DARK: Record<AccountKind, string> = {
  guest: "bg-white/10 text-slate-200",
  customer: "bg-primary text-white",
  company: "bg-teal text-navy",
  staff: "bg-warning text-white"
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "مدير منصة",
  ADMIN: "مشرف",
  REVIEWER: "مراجع تحقق",
  DATA_OPERATOR: "مشغّل جمع بيانات",
  ORG_ADMIN: "مدير المنظمة",
  COMPANY_MANAGER: "مدير شركة",
  OWNER: "مالك",
  VIEWER: "مطّلع"
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export function describeRoles(roles: string[]): string {
  if (!roles.length) return "بدون دور";
  return roles.map(roleLabel).join(" · ");
}

import { API } from "./api";
import { decodeToken, TokenUser } from "./auth";

/**
 * Administration sessions deliberately use a different storage key from the
 * ordinary application session. Signing into the console does not replace the
 * customer/provider session, and an ordinary login never yields an admin token.
 */
export const ADMIN_TOKEN_KEY = "naql_admin_token";
export const ADMIN_EVENT = "naql-admin-change";

export type PlatformRole = "SUPER_ADMIN" | "ADMIN" | "REVIEWER" | "SUPPORT";

export interface AdminUser extends TokenUser {
  platformRole: PlatformRole;
  scope: "admin";
  status: "active" | "suspended";
}

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  SUPER_ADMIN: "مدير منصة أعلى",
  ADMIN: "مدير منصة",
  REVIEWER: "مراجع تحقق",
  SUPPORT: "دعم فني"
};

export const PLATFORM_ROLE_TONE: Record<PlatformRole, string> = {
  SUPER_ADMIN: "bg-amber-100 text-amber-800",
  ADMIN: "bg-blue-100 text-blue-800",
  REVIEWER: "bg-teal-100 text-teal-800",
  SUPPORT: "bg-slate-100 text-slate-700"
};

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function getAdminUser(): AdminUser | null {
  const token = getAdminToken();
  if (!token) return null;
  const decoded = decodeToken(token);
  if (!decoded || decoded.scope !== "admin" || !decoded.platformRole) return null;
  return decoded as AdminUser;
}

export function setAdminSession(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  window.dispatchEvent(new Event(ADMIN_EVENT));
}

export function clearAdminSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  window.dispatchEvent(new Event(ADMIN_EVENT));
}

export function subscribeAdminAuth(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === ADMIN_TOKEN_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(ADMIN_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ADMIN_EVENT, callback);
  };
}

export class AdminApiError extends Error {
  status: number;
  code?: string;
  issues?: unknown;

  constructor(message: string, status = 0, code?: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

function redirectToAdminLogin(reason?: string) {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/admin/login")) return;
  const from = window.location.pathname + window.location.search;
  const params = new URLSearchParams({ next: from });
  if (reason) params.set("reason", reason);
  window.location.href = `/admin/login?${params.toString()}`;
}

/**
 * Fetch wrapper for the administration namespace.
 *
 * It never sends the ordinary application token. A revoked/suspended session is
 * cleared and redirected; an authorization failure (403 insufficient_permission)
 * is surfaced to the caller so the page can explain it.
 */
export async function adminFetch(path: string, init: RequestInit = {}) {
  const token = getAdminToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API}${path}`, { ...init, headers });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  const code = json?.code as string | undefined;
  const sessionInvalid =
    res.status === 401 ||
    code === "admin_session_required" ||
    code === "account_suspended" ||
    code === "session_revoked";

  if (sessionInvalid && typeof window !== "undefined") {
    clearAdminSession();
    redirectToAdminLogin(code ?? "unauthorized");
    throw new AdminApiError("انتهت جلسة الإدارة. الرجاء الدخول من جديد.", res.status, code);
  }

  if (!res.ok) {
    throw new AdminApiError(json?.error ?? `Request failed (${res.status})`, res.status, code, json?.issues);
  }
  return json;
}

export async function loginAdmin(email: string, password: string) {
  const res = await fetch(`${API}/api/v1/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new AdminApiError(json?.error ?? "تعذر تسجيل الدخول", res.status, json?.code, json?.issues);
  }
  return json as { token: string; user: AdminUser; permissions: string[] };
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-EG", { dateStyle: "medium" });
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("ar-EG");
}

export function formatMoney(value: number | string | null | undefined, currency?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return "—";
  return `${numeric.toLocaleString("ar-EG", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

const AUDIT_ACTION_LABEL: Record<string, string> = {
  "admin.login.succeeded": "دخول إداري ناجح",
  "admin.login.failed": "فشل دخول إداري",
  "admin.login.denied": "رفض دخول إداري",
  "admin.logout": "خروج من الإدارة",
  "user.suspended": "إيقاف مستخدم",
  "user.reactivated": "إعادة تفعيل مستخدم",
  "user.platform_role.changed": "تغيير دور منصة",
  "user.platform_role.granted": "منح دور منصة",
  "user.platform_role.imported": "استيراد دور منصة قديم",
  "user.password.reset": "إعادة تعيين كلمة مرور",
  "company.register": "تسجيل شركة",
  "company.submit": "تقديم شركة للتحقق",
  "settings.updated": "تحديث إعدادات المنصة",
  "port.updated": "تحديث بيانات ميناء"
};

export function auditActionLabel(action?: string | null): string {
  if (!action) return "—";
  if (AUDIT_ACTION_LABEL[action]) return AUDIT_ACTION_LABEL[action];
  if (action.startsWith("company.verify.")) {
    const decision = action.split(".").pop();
    const decisionLabel: Record<string, string> = {
      approved: "اعتماد",
      rejected: "رفض",
      needs_information: "طلب معلومات إضافية"
    };
    return `قرار تحقق: ${decisionLabel[decision ?? ""] ?? decision}`;
  }
  return action;
}

export function entityLabel(type?: string | null): string {
  const map: Record<string, string> = {
    User: "مستخدم",
    Company: "شركة",
    Port: "ميناء",
    PlatformSetting: "إعدادات",
    session: "جلسة"
  };
  return type ? map[type] ?? type : "—";
}

export const COMPANY_TYPE_LABEL: Record<string, string> = {
  forwarder: "وكيل شحن",
  carrier: "ناقل",
  shipping: "شحن بحري",
  air: "شحن جوي",
  customs: "تخليص جمركي",
  warehouse: "مستودعات"
};

export const PORT_TYPE_LABEL: Record<string, string> = {
  seaport: "ميناء بحري",
  airport: "مطار",
  inland: "ميناء جاف",
  border: "معبر حدودي"
};

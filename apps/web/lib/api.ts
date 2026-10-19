import { clearSession, getTokenFromStorage } from "./auth";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function getToken() {
  return getTokenFromStorage();
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("token", token);
  window.dispatchEvent(new Event("naql-auth-change"));
}

export function clearToken() {
  clearSession();
}

export class ApiError extends Error {
  status: number;
  issues?: unknown;
  code?: string;
  constructor(message: string, status = 0, issues?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.code = code;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  let json: any = null;
  try { json = await res.json(); } catch { json = null; }

  if (res.status === 401 && typeof window !== "undefined") {
    // Session is gone or expired: clear it and send the user back to login
    // with a return path, instead of rendering a broken empty page.
    const from = window.location.pathname + window.location.search;
    clearSession();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(from)}&expired=1`;
    }
    throw new ApiError("انتهت الجلسة. الرجاء تسجيل الدخول من جديد.", 401, json?.issues);
  }

  if (!res.ok) {
    const message = json?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, json?.issues, json?.code);
  }
  return json;
}

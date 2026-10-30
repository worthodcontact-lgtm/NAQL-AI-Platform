"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  AccountKind,
  clearSession,
  getUserFromToken,
  isPlatformStaffRole,
  setSession,
  subscribeAuth,
  TokenUser
} from "@/lib/auth";

interface AuthContextValue {
  user: TokenUser | null;
  kind: AccountKind;
  /** True once the initial session read has finished (avoids redirect flicker). */
  ready: boolean;
  login: (token: string) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  kind: "guest",
  ready: false,
  login: () => undefined,
  logout: () => undefined,
  refresh: () => undefined
});

/**
 * Resolve presentation state from the authoritative session endpoint.
 *
 * The token is decoded immediately so the UI can render, but account type and
 * trade role are re-read from `/auth/me`. This matters after a customer
 * explicitly creates a provider profile: the existing JWT is still valid, but
 * the organization's classification has changed in PostgreSQL.
 */
async function resolveSession(user: TokenUser): Promise<{ user: TokenUser; kind: AccountKind }> {
  let current = user;
  try {
    const me = await apiFetch("/api/v1/auth/me");
    if (me?.user) current = { ...current, ...me.user };
  } catch {
    // Keep the decoded token; the API will still enforce authorization.
  }

  if (isPlatformStaffRole(current)) return { user: current, kind: "staff" };
  if (current.accountType === "provider") return { user: current, kind: "provider" };
  if (current.accountType === "customer") return { user: current, kind: "customer" };

  // Compatibility path for a pre-classification token if `/auth/me` is
  // temporarily unavailable. A legacy importer/exporter profile is not a
  // provider profile.
  try {
    const mine = await apiFetch("/api/v1/companies/mine");
    const provider = (mine?.items ?? []).some(
      (company: { type?: string }) => company.type && company.type !== "importer_exporter"
    );
    return { user: current, kind: provider ? "provider" : "customer" };
  } catch {
    return { user: current, kind: "customer" };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TokenUser | null>(null);
  const [kind, setKind] = useState<AccountKind>("guest");
  const [ready, setReady] = useState(false);

  const sync = useCallback(async () => {
    const current = getUserFromToken();
    if (!current) {
      setUser(null);
      setKind("guest");
      setReady(true);
      return;
    }

    setUser(current);
    setReady(true);
    const resolved = await resolveSession(current);
    setUser(resolved.user);
    setKind(resolved.kind);
  }, []);

  useEffect(() => {
    void sync();
    return subscribeAuth(() => {
      void sync();
    });
  }, [sync]);

  const login = useCallback((token: string) => {
    setSession(token);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setKind("guest");
    if (typeof window !== "undefined") window.location.href = "/login";
  }, []);

  const refresh = useCallback(() => {
    void sync();
  }, [sync]);

  return (
    <AuthContext.Provider value={{ user, kind, ready, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

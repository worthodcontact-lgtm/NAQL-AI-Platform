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

async function resolveKind(user: TokenUser): Promise<AccountKind> {
  if (isPlatformStaffRole(user.roles)) return "staff";
  try {
    const res = await apiFetch("/api/v1/companies/mine");
    return (res?.items?.length ?? 0) > 0 ? "company" : "customer";
  } catch {
    // No company profile is reachable: treat as a customer account rather than guessing.
    return "customer";
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<TokenUser | null>(null);
  const [kind, setKind] = useState<AccountKind>("guest");
  const [ready, setReady] = useState(false);

  const sync = useCallback(async () => {
    const current = getUserFromToken();
    setUser(current);
    if (!current) {
      setKind("guest");
      setReady(true);
      return;
    }
    setReady(true);
    setKind(await resolveKind(current));
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

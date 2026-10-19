"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AdminUser,
  adminFetch,
  clearAdminSession,
  getAdminToken,
  getAdminUser,
  setAdminSession,
  subscribeAdminAuth
} from "@/lib/admin";

interface AdminAuthContextValue {
  user: AdminUser | null;
  permissions: string[];
  ready: boolean;
  login: (token: string, user: AdminUser, permissions: string[]) => void;
  logout: () => void;
  refresh: () => Promise<void>;
  has: (permission: string) => boolean;
}

const AdminAuthContext = createContext<AdminAuthContextValue>({
  user: null,
  permissions: [],
  ready: false,
  login: () => undefined,
  logout: () => undefined,
  refresh: async () => undefined,
  has: () => false
});

/**
 * Administration session provider.
 *
 * The token is validated against `/api/v1/admin/auth/me` on mount, so a role
 * revocation or suspension is reflected even if the JWT has not expired yet.
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  const validate = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setUser(null);
      setPermissions([]);
      setReady(true);
      return;
    }

    // Optimistic decode avoids a blank screen; the server call below is authoritative.
    setUser(getAdminUser());
    try {
      const res = await adminFetch("/api/v1/admin/auth/me");
      setUser(res.user as AdminUser);
      setPermissions(Array.isArray(res.permissions) ? res.permissions : []);
    } catch {
      setUser(null);
      setPermissions([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void validate();
    return subscribeAdminAuth(() => {
      const token = getAdminToken();
      if (!token) {
        setUser(null);
        setPermissions([]);
        setReady(true);
      } else {
        void validate();
      }
    });
  }, [validate]);

  const login = useCallback((token: string, nextUser: AdminUser, nextPermissions: string[]) => {
    setAdminSession(token);
    setUser(nextUser);
    setPermissions(nextPermissions);
    setReady(true);
  }, []);

  const logout = useCallback(() => {
    void adminFetch("/api/v1/admin/auth/logout", { method: "POST" }).catch(() => undefined);
    clearAdminSession();
    setUser(null);
    setPermissions([]);
    router.replace("/admin/login");
  }, [router]);

  const has = useCallback(
    (permission: string) => permissions.includes(permission) || user?.platformRole === "SUPER_ADMIN",
    [permissions, user?.platformRole]
  );

  const value = useMemo(
    () => ({ user, permissions, ready, login, logout, refresh: validate, has }),
    [user, permissions, ready, login, logout, validate, has]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}

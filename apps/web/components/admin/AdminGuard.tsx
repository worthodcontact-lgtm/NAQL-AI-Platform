"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";

/**
 * Client-side UX guard for the administration console.
 *
 * This is not the security boundary: every `/api/v1/admin/*` call is authorized
 * server-side against the platform role and the specific permission. The guard
 * prevents rendering an unusable console for an unauthenticated visitor.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAdminAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, user, pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-center shadow-panel">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-semibold text-slate-700">جارٍ التحقق من صلاحية الإدارة...</p>
          <p className="mt-1 text-xs text-slate-500">يتم التحقق من الدور الحالي على الخادم</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-center shadow-panel">
          <p className="text-sm font-semibold text-slate-700">لا توجد جلسة إدارة صالحة</p>
          <p className="mt-1 text-xs text-slate-500">جارٍ تحويلك إلى بوابة الإدارة...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

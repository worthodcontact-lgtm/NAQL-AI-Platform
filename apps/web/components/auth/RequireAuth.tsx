"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [ready, user, pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        جارٍ التحقق من الجلسة...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        الجلسة غير صالحة — جارٍ تحويلك إلى صفحة الدخول...
      </div>
    );
  }

  return <>{children}</>;
}

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { getAdminToken, loginAdmin, setAdminSession, adminFetch } from "@/lib/admin";

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  not_platform_staff:
    "هذا الحساب لا يملك دوراً إدارياً على المنصة. حسابات العملاء والشركات لا تمنح وصولاً إلى لوحة الإدارة.",
  account_suspended: "تم إيقاف هذا الحساب. راجع مدير المنصة الأعلى.",
  admin_requires_database: "لوحة الإدارة تتطلب تشغيل قاعدة بيانات PostgreSQL. راجع حالة الخادم.",
  admin_session_required: "هذه البوابة تتطلب جلسة إدارة منفصلة.",
  session_revoked: "انتهت الجلسة أو تغيّرت صلاحياتك. سجّل الدخول من جديد.",
  unauthorized: "انتهت جلسة الإدارة. سجّل الدخول من جديد.",
  rate_limited: "محاولات دخول كثيرة. انتظر دقيقة ثم أعد المحاولة."
};

function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextParam = params.get("next") ?? "";
  const reason = params.get("reason") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(reason ? ERROR_COPY[reason] ?? null : null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  const safeNext = nextParam.startsWith("/admin") && !nextParam.startsWith("//") ? nextParam : "/admin/dashboard";

  useEffect(() => {
    let cancelled = false;
    async function checkExisting() {
      if (!getAdminToken()) {
        setChecking(false);
        return;
      }
      try {
        await adminFetch("/api/v1/admin/auth/me");
        if (!cancelled) router.replace(safeNext);
      } catch {
        if (!cancelled) setChecking(false);
      }
    }
    void checkExisting();
    return () => {
      cancelled = true;
    };
  }, [router, safeNext]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await loginAdmin(email.trim(), password);
      setAdminSession(result.token);
      router.replace(safeNext);
    } catch (caught: any) {
      const code = caught?.code as string | undefined;
      if (caught?.status === 429) setError(ERROR_COPY.rate_limited);
      else if (code && ERROR_COPY[code]) setError(ERROR_COPY[code]);
      else setError(caught?.message ?? "تعذّر تسجيل الدخول. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-teal border-t-transparent" />
          <p className="text-sm text-slate-300">جارٍ التحقق من جلسة الإدارة...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-navy lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden border-l border-white/10 p-10 text-white lg:flex">
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-teal/20 blur-3xl" aria-hidden="true" />

        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-teal px-2 py-1 text-xs font-bold tracking-widest text-navy">NAQL</span>
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Platform Administration</span>
          </div>
          <h1 className="mt-10 text-4xl font-bold leading-tight">
            بوابة إدارة
            <br />
            منصة NAQL AI
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-300">
            مساحة منفصلة لموظفي المنصة المصرح لهم: مراجعة التحققات، إدارة المستخدمين والصلاحيات، متابعة
            الشحنات والطلبات، وسجل تدقيق كامل لكل إجراء.
          </p>
        </div>

        <div className="relative space-y-3">
          {[
            "دخول منفصل تماماً عن حسابات العملاء والشركات",
            "صلاحيات دقيقة: مدير أعلى، مدير، مراجع، ودعم",
            "كل تغيير حساس يُسجَّل بهوية المنفّذ والوقت"
          ].map((item) => (
            <div key={item} className="flex items-start gap-2 text-xs text-slate-300">
              <span className="mt-0.5 text-teal" aria-hidden="true">◆</span>
              <span>{item}</span>
            </div>
          ))}
          <p className="pt-4 text-[11px] leading-relaxed text-slate-500">
            لا يوجد رابط عام يمنح صلاحية إدارية. يتم تزويد أول مدير أعلى عبر أداة خادم محمية.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Admin Sign In</p>
            <h2 className="mt-1 text-2xl font-bold text-navy">تسجيل دخول الإدارة</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              هذه البوابة مخصّصة لموظفي المنصة فقط. تسجيل الدخول العادي لا يمنح أي وصول إداري.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-relaxed text-red-800" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-600">البريد الإلكتروني الإداري</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                className="ltr-text w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>

            <label className="block space-y-1 text-sm">
              <span className="font-medium text-slate-600">كلمة المرور</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="ltr-text w-full rounded-lg border border-slate-200 px-3 py-2.5 pl-16 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-canvas"
                >
                  {showPassword ? "إخفاء" : "إظهار"}
                </button>
              </div>
            </label>

            <Button type="submit" isLoading={busy} className="w-full">
              دخول إلى لوحة الإدارة
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500">
            <Link href="/login" className="font-semibold text-primary hover:underline">
              دخول العملاء والشركات
            </Link>
            <Link href="/" className="hover:underline">
              العودة إلى الموقع
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-navy">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-teal border-t-transparent" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}

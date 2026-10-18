"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { ACCOUNT_KIND_LABEL, ACCOUNT_KIND_TONE } from "@/lib/auth";

export default function PublicHeader() {
  const { user, kind, ready, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4">
        <Link href="/" className="shrink-0">
          <p className="text-xs font-semibold tracking-widest text-teal">NAQL AI</p>
          <h1 className="text-lg font-bold text-navy">NAQL AI</h1>
        </Link>

        <nav className="flex items-center gap-2 sm:gap-3">
          <Link href="/directory" className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-canvas sm:block">
            دليل الشركات
          </Link>

          {!ready && <span className="text-sm text-slate-400">...</span>}

          {ready && user && (
            <>
              <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-block ${ACCOUNT_KIND_TONE[kind]}`}>
                {user.displayName ?? user.email}
              </span>
              <Link href="/dashboard" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                مساحة العمل
              </Link>
              <button onClick={logout} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-canvas">
                خروج
              </button>
            </>
          )}

          {ready && !user && (
            <>
              <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-canvas">
                تسجيل الدخول
              </Link>
              <Link href="/register" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                إنشاء حساب
              </Link>
            </>
          )}
        </nav>
      </div>

      {ready && user && (
        <div className="border-t border-slate-100 bg-canvas px-5 py-1.5 text-center text-xs text-slate-500">
          مسجّل الدخول كـ <span className="font-semibold text-slate-700">{ACCOUNT_KIND_LABEL[kind]}</span>
          {user.organizationId ? <> · المنظمة <span className="ltr-text">{user.organizationId}</span></> : null}
        </div>
      )}
    </header>
  );
}

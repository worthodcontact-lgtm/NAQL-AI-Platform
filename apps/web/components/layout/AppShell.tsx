"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  ACCOUNT_KIND_LABEL,
  ACCOUNT_KIND_PORTAL,
  ACCOUNT_KIND_TONE_DARK,
  describeRoles,
  isPlatformStaffRole,
  roleLabel
} from "@/lib/auth";
import PersistenceBanner from "@/components/layout/PersistenceBanner";

const nav = [
  { href: "/dashboard", label: "لوحة التحكم" },
  { href: "/shipments", label: "الشحنات" },
  { href: "/rfqs", label: "طلبات العروض" },
  { href: "/provider/rfqs", label: "صندوق الطلبات" },
  { href: "/bookings", label: "الحجوزات" },
  { href: "/quotations", label: "العروض" },
  { href: "/costs", label: "حساب التكلفة" },
  { href: "/trade", label: "التجارة الخارجية" },
  { href: "/documents", label: "الوثائق" },
  { href: "/ai", label: "المساعد الذكي" },
  { href: "/directory", label: "دليل الشركات" },
  { href: "/company/register", label: "ملف الشركة" }
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, kind, logout } = useAuth();
  const isStaff = Boolean(user && isPlatformStaffRole(user));
  const links = isStaff ? [...nav, { href: "/admin/login", label: "بوابة الإدارة" }] : nav;
  const initial = (user?.displayName ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 border-l border-slate-200 bg-navy p-5 text-white lg:block">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest text-teal">NAQL AI</p>
          <h1 className="mt-1 text-2xl font-bold">NAQL AI</h1>
          <p className="mt-1 text-sm text-slate-300">PLAN — PREDICT — OPTIMIZE</p>
        </div>

        <div className="mb-6 rounded-xl bg-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">أنت الآن في</p>
          <p className="mt-1 text-sm font-bold text-white">{ACCOUNT_KIND_PORTAL[kind]}</p>
          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${ACCOUNT_KIND_TONE_DARK[kind]}`}>
            {ACCOUNT_KIND_LABEL[kind]}
          </span>
          {user && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
              الأدوار: <span className="text-slate-200">{describeRoles(user.roles)}</span>
            </p>
          )}
          {user?.platformRole && (
            <p className="mt-1 text-[11px] leading-relaxed text-teal">
              دور المنصة: {roleLabel(user.platformRole)}
            </p>
          )}
        </div>

        <nav className="space-y-1">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(pathname, item.href)
                  ? "bg-white/15 text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-6 flex items-center gap-3 rounded-xl bg-white/5 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-navy">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {user?.displayName ?? "مستخدم"}
            </p>
            <p className="ltr-text truncate text-[11px] text-slate-400">{user?.email}</p>
          </div>
        </div>

        {user?.organizationId && (
          <p className="mt-2 truncate text-[10px] text-slate-500">
            المنظمة: <span className="ltr-text">{user.organizationId}</span>
          </p>
        )}

        <button
          onClick={logout}
          className="mt-4 w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-white hover:bg-white/10"
        >
          تسجيل الخروج
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <PersistenceBanner />
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-navy">{ACCOUNT_KIND_PORTAL[kind]}</p>
              <p className="truncate text-xs text-slate-500">
                {user?.displayName ?? user?.email} · <span className="font-semibold">{ACCOUNT_KIND_LABEL[kind]}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <p className="hidden text-sm text-slate-500 sm:block">{new Date().toLocaleDateString("ar-EG")}</p>
              <button
                onClick={logout}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-canvas lg:hidden"
              >
                خروج
              </button>
            </div>
          </div>

          {/* Mobile navigation: the sidebar is hidden below lg, so surface the links here. */}
          <nav className="flex gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2 lg:hidden">
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
                  isActive(pathname, item.href)
                    ? "bg-primary text-white"
                    : "bg-canvas text-slate-600"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

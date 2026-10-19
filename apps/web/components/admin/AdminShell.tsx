"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { PLATFORM_ROLE_LABEL } from "@/lib/admin";

interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "المراقبة",
    items: [
      { href: "/admin/dashboard", label: "نظرة عامة" },
      { href: "/admin/reports", label: "التقارير", permission: "reports.read" },
      { href: "/admin/audit-logs", label: "سجل التدقيق", permission: "audit.read" }
    ]
  },
  {
    title: "الحسابات",
    items: [
      { href: "/admin/users", label: "المستخدمون", permission: "users.read" },
      { href: "/admin/companies", label: "الشركات", permission: "companies.read" },
      { href: "/admin/verifications", label: "طلبات التحقق", permission: "companies.read" }
    ]
  },
  {
    title: "العمليات",
    items: [
      { href: "/admin/shipments", label: "الشحنات", permission: "shipments.read" },
      { href: "/admin/bookings", label: "الحجوزات", permission: "bookings.read" },
      { href: "/admin/rfqs", label: "طلبات العروض", permission: "rfqs.read" },
      { href: "/admin/quotations", label: "عروض الأسعار", permission: "quotations.read" },
      { href: "/admin/ports", label: "الموانئ", permission: "ports.read" }
    ]
  },
  {
    title: "النظام",
    items: [{ href: "/admin/settings", label: "الإعدادات", permission: "settings.read" }]
  }
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { has } = useAdminAuth();

  return (
    <nav className="space-y-5">
      {SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.permission || has(item.permission));
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-teal" : "bg-slate-500"}`}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-teal px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-navy">NAQL</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Admin Console</span>
      </div>
      <h1 className="mt-2 text-xl font-bold text-white">إدارة المنصة</h1>
      <p className="mt-1 text-xs text-slate-400">صلاحيات منفصلة عن حسابات العملاء والشركات</p>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAdminAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const initial = (user?.displayName ?? user?.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="hidden w-72 shrink-0 flex-col border-l border-white/10 bg-navy p-5 text-white lg:flex">
        <Brand />

        <div className="mt-5 flex items-start gap-2 rounded-xl border border-teal/30 bg-teal/10 p-3">
          <span className="mt-0.5 text-teal" aria-hidden="true">◆</span>
          <div>
            <p className="text-[11px] font-semibold text-teal">جلسة إدارة منفصلة</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-300">
              لا تمنحك جلسة العميل أو الشركة أي وصول إلى هذه البوابة.
            </p>
          </div>
        </div>

        <div className="mt-6 flex-1 overflow-y-auto">
          <NavLinks />
        </div>

        <div className="mt-6 rounded-xl bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal text-sm font-bold text-navy">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{user?.displayName ?? "موظف منصة"}</p>
              <p className="ltr-text truncate text-[11px] text-slate-400">{user?.email}</p>
            </div>
          </div>
          {user?.platformRole && (
            <p className="mt-2 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
              {PLATFORM_ROLE_LABEL[user.platformRole]}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={logout}
              className="flex-1 rounded-lg border border-white/20 px-2 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
            >
              خروج من الإدارة
            </button>
            <Link
              href="/"
              className="rounded-lg border border-white/20 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10"
            >
              الموقع
            </Link>
          </div>
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
          كل إجراء إداري يُسجّل في سجل التدقيق مع هوية المنفّذ والوقت.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setMobileOpen((value) => !value)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 lg:hidden"
                aria-label="القائمة"
                aria-expanded={mobileOpen}
              >
                ☰
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-navy">لوحة إدارة NAQL AI</p>
                <p className="truncate text-[11px] text-slate-500">
                  {user?.platformRole ? PLATFORM_ROLE_LABEL[user.platformRole] : "—"} · جلسة إدارة
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-xs text-slate-500 sm:block" dir="rtl">
                {new Date().toLocaleDateString("ar-EG", { dateStyle: "full" })}
              </span>
              <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold text-teal-dark">
                بيئة {process.env.NEXT_PUBLIC_APP_ENV ?? "تطوير"}
              </span>
            </div>
          </div>

          {mobileOpen && (
            <div className="max-h-[70vh] overflow-y-auto border-t border-slate-100 bg-navy px-4 py-4 lg:hidden">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
              <button
                onClick={logout}
                className="mt-4 w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-white hover:bg-white/10"
              >
                خروج من الإدارة
              </button>
            </div>
          )}
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

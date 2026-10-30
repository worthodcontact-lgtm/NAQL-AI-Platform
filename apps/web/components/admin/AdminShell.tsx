"use client";

import Link from "next/link";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { PLATFORM_ROLE_LABEL } from "@/lib/admin";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import MegaNavbar, { MegaNavGroup } from "@/components/layout/MegaNavbar";

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
      { href: "/admin/audit-logs", label: "سجل التدقيق", permission: "audit.read" },
      { href: "/admin/integrations", label: "حالة التكاملات", permission: "metrics.read" }
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

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout, has } = useAdminAuth();
  const groups: MegaNavGroup[] = SECTIONS.map((section) => ({
    label: section.title,
    links: section.items.filter((item) => !item.permission || has(item.permission))
      .map(({ href, label }) => ({ href, label }))
  })).filter((section) => section.links?.length);

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <MegaNavbar brandHref="/admin/dashboard" brandLabel="NAQL Admin" subtitle="إدارة المنصة" groups={groups} actions={
        <>
          <ThemeToggle />
          <span className="hidden max-w-40 truncate text-xs text-slate-500 lg:inline">{user?.displayName ?? user?.email}</span>
          <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold text-teal-dark">بيئة {process.env.NEXT_PUBLIC_APP_ENV ?? "تطوير"}</span>
          {user?.platformRole && <span className="hidden text-xs font-semibold text-primary xl:inline">{PLATFORM_ROLE_LABEL[user.platformRole]}</span>}
          <Link href="/" className="hidden rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-canvas dark:text-slate-300 md:inline-flex">الموقع</Link>
          <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-canvas dark:border-slate-700 dark:text-slate-200">خروج</button>
        </>
      } />
      <div className="border-b border-teal/20 bg-teal/5 px-4 py-2 text-center text-xs text-slate-500">
        جلسة إدارة منفصلة عن حسابات العملاء والشركات · كل إجراء إداري يُسجّل في سجل التدقيق
      </div>
      <main className="flex-1 px-4 py-6 lg:px-8"><div className="mx-auto w-full max-w-[1440px]">{children}</div></main>
    </div>
  );
}

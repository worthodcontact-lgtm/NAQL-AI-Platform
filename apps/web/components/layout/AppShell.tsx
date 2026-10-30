"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  ACCOUNT_KIND_LABEL,
  ACCOUNT_KIND_PORTAL,
  ACCOUNT_KIND_TONE_DARK,
  describeRoles,
  isPlatformStaffRole,
  roleLabel,
  tradeRoleLabel
} from "@/lib/auth";
import PersistenceBanner from "@/components/layout/PersistenceBanner";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import MegaNavbar, { MegaNavGroup } from "@/components/layout/MegaNavbar";

type NavItem = {
  href: string;
  label: string;
  section: string;
  permission?: string;
  requiresCompany?: boolean;
  providerOnly?: boolean;
};

const nav: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", section: "الرئيسية" },
  { href: "/shipments", label: "الشحنات", section: "العمليات", permission: "shipments.read" },
  { href: "/rfqs", label: "طلبات العروض", section: "العمليات", permission: "rfqs.read" },
  {
    href: "/provider/rfqs",
    label: "صندوق وفرص الطلبات",
    section: "العمليات",
    permission: "rfqs.read",
    requiresCompany: true,
    providerOnly: true
  },
  { href: "/bookings", label: "الحجوزات", section: "العمليات", permission: "bookings.read" },
  { href: "/quotations", label: "العروض", section: "العمليات", permission: "rfqs.read" },
  { href: "/costs", label: "حساب التكلفة", section: "الأدوات والبيانات", permission: "costs.read" },
  { href: "/trade", label: "التجارة الخارجية", section: "الأدوات والبيانات" },
  { href: "/ai", label: "المساعد الذكي", section: "الأدوات والبيانات" },
  { href: "/documents", label: "الوثائق", section: "مساحة العمل", permission: "shipments.documents.read" },
  { href: "/notifications", label: "التنبيهات", section: "مساحة العمل" },
  { href: "/directory", label: "دليل الشركات", section: "الشركات" },
  { href: "/company/register", label: "ملف الشركة", section: "الشركات", permission: "company.settings.manage" },
  { href: "/settings", label: "فريق الشركة", section: "الشركات", permission: "company.members.read" }
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, kind, logout } = useAuth();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  const [hasCompany, setHasCompany] = useState<boolean | null>(null);
  const isStaff = Boolean(user && isPlatformStaffRole(user));
  const visibleNav = nav.filter((item) => {
    if (item.requiresCompany && hasCompany === false) return false;
    if (item.providerOnly && kind !== "provider") return false;
    if (item.permission && permissions && !permissions.has(item.permission)) return false;
    return true;
  });
  const links: NavItem[] = isStaff
    ? [...visibleNav, { href: "/admin/login", label: "بوابة الإدارة", section: "النظام" }]
    : visibleNav;
  const groups: MegaNavGroup[] = [...new Set(links.map((item) => item.section))].map((section) => {
    const items = links.filter((item) => item.section === section);
    return items.length === 1
      ? { label: section, href: items[0].href }
      : { label: section, links: items.map(({ href, label }) => ({ href, label })) };
  });

  useEffect(() => {
    if (!user) {
      setUnreadNotifications(0);
      setPermissions(null);
      setHasCompany(null);
      return;
    }
    let active = true;
    apiFetch("/api/v1/notifications?limit=1&unreadOnly=true")
      .then((res) => {
        if (active) setUnreadNotifications(Number(res.unreadCount) || 0);
      })
      .catch(() => {
        if (active) setUnreadNotifications(0);
      });
    return () => {
      active = false;
    };
  }, [user, pathname]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([
      apiFetch("/api/v1/company"),
      apiFetch("/api/v1/companies/mine")
    ])
      .then(([context, mine]) => {
        if (!active) return;
        setPermissions(new Set(context?.context?.permissions ?? []));
        setHasCompany(Array.isArray(mine?.items) && mine.items.length > 0);
      })
      .catch(() => {
        // Navigation is a usability layer. Authorization is always re-checked
        // by the API. If the context cannot be loaded, keep the full menu
        // rather than rendering a blank shell; every action remains guarded.
        if (!active) return;
        setPermissions(null);
        setHasCompany(null);
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div className="flex min-h-screen flex-col">
        <PersistenceBanner />
        <MegaNavbar brandHref="/dashboard" subtitle={ACCOUNT_KIND_PORTAL[kind]} groups={groups} actions={
          <>
            <ThemeToggle />
            <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-block ${ACCOUNT_KIND_TONE_DARK[kind]}`}>{ACCOUNT_KIND_LABEL[kind]}</span>
            {user && <span className="hidden max-w-44 truncate text-xs text-slate-500 lg:inline">{user.displayName ?? user.email}</span>}
            {user?.platformRole && <span className="hidden text-xs font-semibold text-primary xl:inline">{roleLabel(user.platformRole)}</span>}
            {user?.tradeRole && <span className="hidden text-xs text-slate-500 xl:inline">{tradeRoleLabel(user.tradeRole)}</span>}
            <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-canvas dark:border-slate-700 dark:text-slate-200">خروج</button>
          </>
        } />
        <div className="border-b border-slate-200 bg-canvas px-4 py-1.5 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          {user?.displayName ?? user?.email} · {ACCOUNT_KIND_PORTAL[kind]}
          {unreadNotifications > 0 && <> · <a href="/notifications" className="font-semibold text-primary">{unreadNotifications} تنبيه غير مقروء</a></>}
          {user?.organizationId && <> · المنظمة <span className="ltr-text">{user.organizationId}</span></>}
          {user && <> · الأدوار: {describeRoles(user.roles)}</>}
        </div>
        <main className="flex-1 px-5 py-6 lg:px-8"><div className="mx-auto w-full max-w-[1440px]">{children}</div></main>
    </div>
  );
}

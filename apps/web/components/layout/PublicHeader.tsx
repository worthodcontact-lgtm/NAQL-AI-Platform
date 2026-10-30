"use client";

import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { ACCOUNT_KIND_LABEL, ACCOUNT_KIND_TONE } from "@/lib/auth";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import MegaNavbar, { MegaNavGroup } from "@/components/layout/MegaNavbar";

export default function PublicHeader() {
  const { user, kind, ready, logout } = useAuth();
  const groups: MegaNavGroup[] = [
    { label: "الرئيسية", href: "/" },
    { label: "ذكاء التجارة", links: [
      { href: user ? "/trade" : "/login?next=%2Ftrade", label: "بيانات التجارة", description: "إحصاءات تجارة دولية من UN Comtrade مع توثيق المصدر." },
      { href: user ? "/analytics" : "/login?next=%2Fanalytics", label: "التحليلات", description: "مساحة التحليلات المتاحة داخل المنصة." }
    ] },
    { label: "الشحن", links: [
      { href: user ? "/shipments" : "/login?next=%2Fshipments", label: "إدارة الشحنات", description: "إنشاء الشحنات ومتابعة حالات سير العمل المسجلة." },
      { href: user ? "/bookings" : "/login?next=%2Fbookings", label: "الحجوزات", description: "إدارة الحجوزات المرتبطة بعروض الأسعار." }
    ] },
    { label: "سوق الخدمات", links: [
      { href: "/directory", label: "دليل الشركات", description: "استكشف ملفات الشركات اللوجستية المسجلة." },
      { href: user ? "/rfqs" : "/login?next=%2Frfqs", label: "طلبات عروض الأسعار", description: "أنشئ طلبًا أو أدر طلباتك ضمن مساحة العمل." },
      ...(kind === "provider" ? [{ href: "/provider/rfqs", label: "فرص المزوّدين", description: "الفرص المتاحة لشركاتك بحسب صلاحياتها." }] : [])
    ] },
    { label: "الخدمات", href: "/#services" },
    { label: "عن المنصة", href: "/#about" }
  ];

  return (
    <>
      <MegaNavbar groups={groups} actions={
        <>
          <Link href="/directory" className="focus-ring hidden rounded-lg px-2 py-2 text-sm font-semibold text-slate-600 hover:bg-canvas dark:text-slate-200 dark:hover:bg-white/10 lg:inline-flex">دليل الشركات</Link>
          <ThemeToggle />
          {!ready && <span className="px-2 text-xs text-slate-500">…</span>}
          {ready && user && <>
            <Link href="/notifications" className="focus-ring rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-200">التنبيهات</Link>
            <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-block ${ACCOUNT_KIND_TONE[kind]}`}>{ACCOUNT_KIND_LABEL[kind]}</span>
            <Link href="/dashboard" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark">مساحة العمل</Link>
            <button onClick={logout} className="rounded-lg px-2 py-2 text-sm font-semibold text-slate-500 hover:bg-canvas dark:text-slate-300 dark:hover:bg-white/10">خروج</button>
          </>}
          {ready && !user && <>
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-canvas dark:text-slate-200 dark:hover:bg-white/10">دخول</Link>
            <Link href="/register" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark">إنشاء حساب</Link>
          </>}
        </>
      } />
      {ready && user && <div className="border-b border-slate-200 bg-canvas px-4 py-2 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">
        مسجّل الدخول كـ <span className="font-semibold text-slate-700 dark:text-slate-100">{ACCOUNT_KIND_LABEL[kind]}</span>
        {user.organizationId ? <> · المنظمة <span className="ltr-text">{user.organizationId}</span></> : null}
      </div>}
    </>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";

export interface MegaNavLink { href: string; label: string; description?: string; }
export interface MegaNavGroup { label: string; href?: string; links?: MegaNavLink[]; }

export default function MegaNavbar({
  groups,
  actions,
  brandHref = "/",
  brandLabel = "NAQL AI",
  subtitle = "PLAN. PREDICT. OPTIMIZE."
}: {
  groups: MegaNavGroup[];
  actions?: React.ReactNode;
  brandHref?: string;
  brandLabel?: string;
  subtitle?: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/90">
      <div className="mx-auto flex min-h-[76px] max-w-[1440px] items-center gap-5 px-4 sm:px-6 lg:px-8">
        <Link href={brandHref} onClick={close} className="flex shrink-0 items-center gap-3" aria-label={`${brandLabel} home`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-sm font-black tracking-tight text-white shadow-sm">N</span>
          <span className="leading-tight">
            <span className="block text-base font-extrabold tracking-wide text-navy">{brandLabel}</span>
            <span className="hidden text-[9px] font-bold tracking-[.16em] text-slate-500 sm:block">{subtitle}</span>
          </span>
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 xl:flex" aria-label="التنقل الرئيسي">
          {groups.map((group) => group.links?.length ? (
            <details key={group.label} className="group relative">
              <summary className="focus-ring flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-canvas hover:text-navy dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white">
                {group.label}<span className="text-[10px] opacity-60" aria-hidden="true">⌄</span>
              </summary>
              <div className="absolute start-0 top-full z-50 mt-3 w-[min(44rem,90vw)] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                <div className="grid gap-1 sm:grid-cols-2">
                  {group.links.map((item) => (
                    <Link key={item.href} href={item.href} className="rounded-xl p-3 transition-colors hover:bg-canvas dark:hover:bg-white/5">
                      <span className="block text-sm font-bold text-navy dark:text-white">{item.label}</span>
                      {item.description && <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            </details>
          ) : group.href ? (
            <Link key={group.label} href={group.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-canvas hover:text-navy dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white">{group.label}</Link>
          ) : null)}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-2 xl:ms-0">
          <div className="hidden items-center gap-2 md:flex">{actions}</div>
          <button type="button" onClick={() => setMobileOpen((value) => !value)} className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-navy dark:border-slate-700 dark:text-white xl:hidden" aria-label={mobileOpen ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={mobileOpen}>
            <span aria-hidden="true" className="text-lg">{mobileOpen ? "×" : "☰"}</span>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 pb-5 pt-3 dark:border-slate-700 dark:bg-slate-900 xl:hidden">
          <nav className="mx-auto grid max-w-[1440px] gap-1 sm:grid-cols-2" aria-label="التنقل للجوال">
            {groups.map((group) => (
              <div key={group.label} className="rounded-xl p-2">
                {group.href ? <Link href={group.href} onClick={close} className="block rounded-lg px-3 py-2.5 text-sm font-bold text-navy dark:text-white">{group.label}</Link> : <p className="px-3 py-2 text-xs font-bold text-primary">{group.label}</p>}
                {group.links?.map((item) => <Link key={item.href} href={item.href} onClick={close} className="block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-canvas dark:text-slate-300 dark:hover:bg-white/5">{item.label}</Link>)}
              </div>
            ))}
          </nav>
          <div className="mx-auto mt-3 flex max-w-[1440px] flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 md:hidden">{actions}</div>
        </div>
      )}
    </header>
  );
}

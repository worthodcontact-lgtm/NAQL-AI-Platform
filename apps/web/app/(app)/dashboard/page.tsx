"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { ACCOUNT_KIND_LABEL, tradeRoleLabel } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function DashboardPage() {
  const { user, kind } = useAuth();
  const [health, setHealth] = useState<string>("checking...");
  const [shipments, setShipments] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/health`).then((r) => r.json()).then((d) => setHealth(JSON.stringify(d))).catch(() => setHealth("offline"));
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${API}/api/v1/shipments`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((d) => setShipments(Array.isArray(d.items) ? d.items : []))
        .catch(() => setShipments([]));
    }
  }, []);

  const isProvider = kind === "provider";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader title="لوحة التحكم" description={`حالة API: ${health}`} eyebrow="NAQL AI" />

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">نوع حسابك الحالي</p>
            <h2 className="mt-1 text-xl font-bold text-navy">
              {ACCOUNT_KIND_LABEL[kind]}
            </h2>
            {user?.tradeRole && (
              <p className="mt-1 text-sm text-slate-600">
                نشاط التجارة الخارجية: <span className="font-semibold">{tradeRoleLabel(user.tradeRole)}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isProvider ? (
              <>
                <Link
                  href="/provider/rfqs"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                >
                  صندوق وفرص الطلبات
                </Link>
                <Link
                  href="/company/register"
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-canvas"
                >
                  ملف مزوّد الخدمة
                </Link>
              </>
            ) : (
              <Link
                href="/rfqs"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                طلبات العروض
              </Link>
            )}
          </div>
        </div>
        {isProvider ? (
          <p className="mt-3 rounded-lg bg-teal/10 px-3 py-2 text-xs leading-relaxed text-teal-dark">
            دخول المزوّد لا يفتح طلبات العملاء الخاصة. تظهر فقط الطلبات الموجهة لشركاتك أو فرص
            السوق التي تنضم إليها صراحة. التحقق من المنشأة منفصل عن إنشاء الحساب.
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-xs leading-relaxed text-primary">
            حسابك عميل ومستورد/مصدّر. لا يمنحك التسجيل صلاحيات مزوّد الخدمة. لتصبح مزوّداً، أنشئ
            ملف منشأة لوجستية صراحةً ثم أرسله للمراجعة.
          </p>
        )}
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">الشحنات</div>
          <div className="text-3xl font-bold">{shipments.length}</div>
        </div>
      </div>
    </main>
  );
}

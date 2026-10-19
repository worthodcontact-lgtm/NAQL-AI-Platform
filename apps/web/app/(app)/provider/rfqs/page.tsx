"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

/**
 * Provider inbox: RFQs addressed to a company owned by the signed-in organization.
 * The list is produced by the API from company ownership; nothing is filtered client-side.
 */
export default function ProviderInboxPage() {
  const [items, setItems] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/rfqs/incoming");
      setItems(res.items ?? []);
      setCompanies(res.companies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الصندوق.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">صندوق طلبات العروض</h1>
        <p className="mt-1 text-sm text-slate-500">
          الطلبات الموجّهة لشركاتك. قدّم عرضك، وسيقرر العميل بعد المقارنة.
        </p>
      </div>

      {error && <p className="text-error">{error}</p>}

      {!loading && companies.length === 0 && (
        <EmptyState
          title="لا توجد شركة مسجّلة"
          description="قدّم ملف شركتك أولاً حتى تتمكن من استقبال طلبات العروض."
          action={
            <Link href="/company/register" className="text-sm font-semibold text-primary">
              تسجيل ملف الشركة
            </Link>
          }
        />
      )}

      {loading && <Skeleton className="h-40" />}

      {!loading && companies.length > 0 && items.length === 0 && (
        <EmptyState title="لا توجد طلبات حالياً" description="ستظهر هنا طلبات العروض الموجّهة لشركاتك." />
      )}

      <div className="space-y-3">
        {items.map((row) => {
          const rfq = row.rfq ?? {};
          const existing = (rfq.quotes ?? []).filter((q: any) => q.companyId === row.company?.id);
          return (
            <Card key={row.id}>
              <CardHeader
                title={`${rfq.origin ?? "—"} → ${rfq.destination ?? "—"}`}
                subtitle={`${rfq.mode ?? ""} · ${rfq.cargoDescription ?? ""}`}
                action={
                  existing.length > 0 ? (
                    <Badge variant="success">تم إرسال عرض</Badge>
                  ) : (
                    <Badge variant="warning">بانتظار عرضك</Badge>
                  )
                }
              />
              <div className="flex items-center justify-between gap-4 p-5">
                <div className="text-sm text-slate-500">
                  <p>
                    بصفة: <span className="font-semibold text-slate-700">{row.company?.name ?? "—"}</span>
                  </p>
                  <p className="mt-1">
                    الوزن: <span className="ltr-text">{String(rfq.weightKg ?? "—")}</span> kg
                  </p>
                </div>
                <Link href={`/provider/rfqs/${rfq.id ?? row.rfqId}`} className="text-sm font-semibold text-primary">
                  فتح الطلب
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

/**
 * Provider inbox: RFQs addressed to a company owned by the signed-in organization.
 * The list is produced by the API from company ownership; nothing is filtered client-side.
 */
export default function ProviderInboxPage() {
  const [items, setItems] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [joining, setJoining] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [res, opportunityRes] = await Promise.all([
        apiFetch("/api/v1/rfqs/incoming"),
        apiFetch("/api/v1/rfqs/opportunities").catch(() => ({ items: [] }))
      ]);
      setItems(res.items ?? []);
      setCompanies(res.companies ?? []);
      setOpportunities(opportunityRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الصندوق.");
    } finally {
      setLoading(false);
    }
  }

  async function joinOpportunity(rfqId: string, companyId: string) {
    setJoining(rfqId);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/rfqs/${rfqId}/join`, {
        method: "POST",
        body: JSON.stringify({ companyId })
      });
      setNotice("تم الانضمام إلى فرصة السوق. يمكنك الآن فتح الطلب وتقديم عرض.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر الانضمام إلى الفرصة.");
    } finally {
      setJoining("");
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

      {error && <p role="alert" className="text-error">{error}</p>}
      {notice && <p className="text-sm text-teal-dark">{notice}</p>}

      {!loading && companies.length > 0 && opportunities.length > 0 && (
        <section id="opportunities" className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-navy">فرص السوق المفتوح</h2>
            <p className="text-xs text-slate-500">
              طلبات اختار العميل عرضها لمزودين مسجلين مؤهلين. البيانات محدودة، ولا تُعرض هوية العميل أو
              مستنداته أو عروض المنافسين. الانضمام خطوة صريحة قبل تقديم العرض.
            </p>
          </div>
          {opportunities.map((opportunity) => {
            const eligibleCompany = companies.find((company) =>
              opportunity.eligibleCompanyIds?.includes(company.id)
            );
            return (
              <div key={opportunity.id} data-testid={`opportunity-${opportunity.id}`}>
                <Card>
                <CardHeader
                  title={`${opportunity.origin} → ${opportunity.destination}`}
                  subtitle={`${opportunity.mode} · ${opportunity.cargoDescription}`}
                  action={
                    opportunity.joined ? (
                      <Badge variant="success">منضم</Badge>
                    ) : (
                      <Badge variant="info">فرصة سوق</Badge>
                    )
                  }
                />
                <div className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                  <div className="text-slate-500">
                    <p>الوزن: <span className="ltr-text">{String(opportunity.weightKg ?? "—")}</span> kg
                      {opportunity.volumeCbm ? ` · الحجم: ${opportunity.volumeCbm} CBM` : ""}</p>
                    <p className="mt-1">الخدمة: {opportunity.requiredService ?? "غير محددة"} · بضاعة خطرة: {opportunity.isHazardous ? "نعم" : "لا"}</p>
                    <p className="mt-1 text-xs text-slate-400">مستندات مشتركة: {opportunity.publicDocumentCount ?? 0}</p>
                  </div>
                  {opportunity.joined ? (
                    <Link href={`/provider/rfqs/${opportunity.id}`} className="text-sm font-semibold text-primary">فتح الطلب</Link>
                  ) : eligibleCompany ? (
                    <Button
                      size="sm"
                      isLoading={joining === opportunity.id}
                      onClick={() => void joinOpportunity(opportunity.id, eligibleCompany.id)}
                    >
                      الانضمام بصفة {eligibleCompany.name}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">لا توجد شركة مؤهلة</span>
                  )}
                </div>
                </Card>
              </div>
            );
          })}
        </section>
      )}

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

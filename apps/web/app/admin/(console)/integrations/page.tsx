"use client";

import { AdminPageHeader, ErrorPanel, LoadingPanel } from "@/components/admin/ui";
import { useAdminResource } from "@/lib/useAdminResource";

type Integration = { id: string; provider: string; status: string; configuration: string; connectivity: string; operation: string; capabilities: string[]; evidence: string; checkedAt: string; nextAction?: string };
type Registry = { generatedAt: string; items: Integration[] };

const labels: Record<string, string> = {
  AVAILABLE: "متاح ومتحقق", DEGRADED: "متاح جزئياً", UNAVAILABLE: "غير متاح",
  NOT_CONFIGURED: "غير مُعدّ", UNVERIFIED: "غير متحقق"
};
const tones: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800", DEGRADED: "bg-amber-100 text-amber-800",
  UNAVAILABLE: "bg-red-100 text-red-800", NOT_CONFIGURED: "bg-slate-100 text-slate-700",
  UNVERIFIED: "bg-blue-100 text-blue-800"
};
const evidenceLabels: Record<string, string> = {
  configured: "الإعداد: مُعدّ", not_configured: "الإعداد: غير مُعدّ",
  verified: "الاتصال: ناجح", failed: "الاتصال: فشل", not_checked: "الاتصال: لم يُفحص", not_applicable: "الاتصال: غير منطبق",
  not_verified: "العملية: لم تُتحقق", not_available: "العملية: غير متاحة"
};

export default function IntegrationsPage() {
  const { data, loading, error, reload } = useAdminResource<Registry>("/api/v1/admin/integrations");
  return <div>
    <AdminPageHeader title="حالة التكاملات" description="الحالة مبنية على فحوص تشغيلية أو أدلة إعداد صريحة؛ وجود بيانات اعتماد وحده لا يعني أن الخدمة متاحة." />
    {loading && <LoadingPanel label="جارٍ فحص التكاملات..." />}
    {error && !loading && <ErrorPanel message={error} onRetry={reload} />}
    {data && <div className="space-y-3">
      <p className="text-xs text-slate-500">آخر فحص: {new Date(data.generatedAt).toLocaleString("ar-EG")}</p>
      {data.items.map((item) => <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold text-slate-900">{item.provider}</h2><p className="text-xs text-slate-500">{item.capabilities.join(" · ")}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tones[item.status] ?? tones.UNVERIFIED}`}>{labels[item.status] ?? item.status}</span>
        </div>
        <p className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
          {[item.configuration, item.connectivity, item.operation].map((state) => <span key={state} className="rounded bg-slate-100 px-2 py-1">{evidenceLabels[state] ?? state}</span>)}
        </p>
        <p className="mt-3 text-sm text-slate-700">{item.evidence}</p>
        {item.nextAction && <p className="mt-1 text-xs text-slate-500">الخطوة التالية: {item.nextAction}</p>}
      </article>)}
    </div>}
  </div>;
}

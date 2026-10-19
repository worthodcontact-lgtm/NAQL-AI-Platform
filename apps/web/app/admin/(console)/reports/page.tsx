"use client";

import { AdminPageHeader, ErrorPanel, LoadingPanel, MiniBars, statusLabel } from "@/components/admin/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface Reports {
  shipmentsByStatus: { status: string; count: number }[];
  bookingsByStatus: { status: string; count: number }[];
  rfqsByStatus: { status: string; count: number }[];
  quotesByStatus: { status: string; count: number }[];
  companiesByVerification: { verificationStatus: string; count: number }[];
  topOrganizationsByShipments: { organizationId: string; name: string | null; count: number }[];
  quoteTotalsByCurrency: { currency: string; count: number; totalAmount: number | string | null }[];
  generatedAt: string;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
      <h2 className="text-sm font-bold text-navy">{title}</h2>
      {subtitle && <p className="mb-4 mt-1 text-xs text-slate-500">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export default function AdminReportsPage() {
  const { data, loading, error, reload } = useAdminResource<Reports>("/api/v1/admin/reports");

  return (
    <div>
      <AdminPageHeader
        title="التقارير"
        description="تجميعات مباشرة من قاعدة البيانات لأغراض تشغيلية. لا تُجمع المبالغ بين عملات مختلفة."
        action={
          data ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500">
              {formatDate(data.generatedAt)}
            </span>
          ) : undefined
        }
      />

      {loading && <LoadingPanel label="جارٍ احتساب التقارير..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="الشحنات حسب الحالة" subtitle="من جدول الشحنات">
              <MiniBars
                items={data.shipmentsByStatus.map((row) => ({ label: statusLabel(row.status), value: row.count }))}
                emptyLabel="لا توجد شحنات."
              />
            </Panel>
            <Panel title="الحجوزات حسب الحالة" subtitle="من جدول طلبات الحجز">
              <MiniBars
                items={data.bookingsByStatus.map((row) => ({ label: statusLabel(row.status), value: row.count }))}
                emptyLabel="لا توجد حجوزات."
              />
            </Panel>
            <Panel title="طلبات العروض حسب الحالة" subtitle="من جدول الطلبات">
              <MiniBars
                items={data.rfqsByStatus.map((row) => ({ label: statusLabel(row.status), value: row.count }))}
                emptyLabel="لا توجد طلبات."
              />
            </Panel>
            <Panel title="العروض حسب الحالة" subtitle="من جدول عروض الأسعار">
              <MiniBars
                items={data.quotesByStatus.map((row) => ({ label: statusLabel(row.status), value: row.count }))}
                emptyLabel="لا توجد عروض."
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="الشركات حسب حالة التحقق" subtitle="قرارات مراجعة داخلية وليست اعتماداً حكومياً">
              <MiniBars
                items={data.companiesByVerification.map((row) => ({
                  label: statusLabel(row.verificationStatus),
                  value: row.count
                }))}
                emptyLabel="لا توجد شركات."
              />
            </Panel>

            <Panel title="أعلى المنظمات بعدد الشحنات" subtitle="أول 10 منظمات">
              {data.topOrganizationsByShipments.length === 0 ? (
                <p className="text-sm text-slate-500">لا توجد بيانات كافية.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topOrganizationsByShipments.map((row, index) => (
                    <li key={row.organizationId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-[11px] font-bold text-slate-500">
                          {index + 1}
                        </span>
                        {row.name ?? row.organizationId}
                      </span>
                      <span className="font-semibold text-slate-700">{formatNumber(row.count)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          <Panel title="إجماليات العروض حسب العملة" subtitle="كل صف مستقل؛ لا يوجد تحويل عملات">
            {data.quoteTotalsByCurrency.length === 0 ? (
              <p className="text-sm text-slate-500">لا توجد عروض مسجلة.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead>
                    <tr>
                      {["العملة", "عدد العروض", "إجمالي القيم"].map((header) => (
                        <th key={header} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.quoteTotalsByCurrency.map((row) => (
                      <tr key={row.currency}>
                        <td className="px-3 py-2 font-semibold text-slate-700">{row.currency}</td>
                        <td className="px-3 py-2 text-slate-600">{formatNumber(row.count)}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">{formatMoney(row.totalAmount, row.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <p className="text-[11px] leading-relaxed text-slate-500">
            هذه التقارير لا تتضمن تنبؤات أو تقديرات. أي قيمة فارغة تعني عدم وجود سجلات مطابقة في قاعدة البيانات، وليست تقديراً.
          </p>
        </div>
      )}
    </div>
  );
}

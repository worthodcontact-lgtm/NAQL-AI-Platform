"use client";

import Link from "next/link";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { AdminPageHeader, ErrorPanel, LoadingPanel, MiniBars, StatCard, statusLabel } from "@/components/admin/ui";
import { auditActionLabel, entityLabel, formatDate, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface Overview {
  users: { total: number; active: number; suspended: number };
  organizations: { total: number };
  companies: { total: number; verified: number; pending: number };
  shipments: { total: number; byStatus: { status: string; count: number }[] };
  rfqs: { total: number; pending: number };
  quotes: { total: number; pending: number };
  bookings: { total: number; pending: number };
  recentAudit: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    outcome: string;
    actorUserId: string | null;
    actorRole: string | null;
    createdAt: string;
  }[];
  recentAuditVisible: boolean;
  health: { api: string; database: string; persistenceMode: string };
  generatedAt: string;
}

export default function AdminDashboardPage() {
  const { user } = useAdminAuth();
  const { data, loading, error, reload } = useAdminResource<Overview>("/api/v1/admin/overview");

  return (
    <div>
      <AdminPageHeader
        title={`مرحباً${user?.displayName ? `، ${user.displayName}` : ""}`}
        description="مؤشرات مباشرة من قاعدة البيانات. القيم صفر تعني عدم وجود سجلات، وليست بيانات مفقودة."
        action={
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500">
            {data ? `آخر تحديث: ${formatDate(data.generatedAt)}` : "جارٍ التحديث"}
          </span>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل مؤشرات المنصة..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="إجمالي المستخدمين"
              value={formatNumber(data.users.total)}
              hint={`${formatNumber(data.users.active)} نشط · ${formatNumber(data.users.suspended)} موقوف`}
              href="/admin/users"
            />
            <StatCard label="المنظمات" value={formatNumber(data.organizations.total)} hint="منظمات مسجلة على المنصة" />
            <StatCard
              label="الشركات الموثّقة"
              value={formatNumber(data.companies.verified)}
              hint={`من أصل ${formatNumber(data.companies.total)} شركة`}
              tone="success"
              href="/admin/companies"
            />
            <StatCard
              label="تحققات بانتظار المراجعة"
              value={formatNumber(data.companies.pending)}
              hint="تحتاج قراراً موثقاً"
              tone={data.companies.pending > 0 ? "warning" : "neutral"}
              href="/admin/verifications"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="الشحنات" value={formatNumber(data.shipments.total)} href="/admin/shipments" />
            <StatCard
              label="طلبات عروض معلّقة"
              value={formatNumber(data.rfqs.pending)}
              hint={`من أصل ${formatNumber(data.rfqs.total)} طلب`}
              tone={data.rfqs.pending > 0 ? "warning" : "neutral"}
              href="/admin/rfqs"
            />
            <StatCard
              label="عروض أسعار معلّقة"
              value={formatNumber(data.quotes.pending)}
              hint={`من أصل ${formatNumber(data.quotes.total)} عرض`}
              tone={data.quotes.pending > 0 ? "warning" : "neutral"}
              href="/admin/quotations"
            />
            <StatCard
              label="حجوزات بانتظار القرار"
              value={formatNumber(data.bookings.pending)}
              hint={`من أصل ${formatNumber(data.bookings.total)} حجز`}
              tone={data.bookings.pending > 0 ? "warning" : "neutral"}
              href="/admin/bookings"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-sm font-bold text-navy">الشحنات حسب الحالة</h2>
              <p className="mb-4 mt-1 text-xs text-slate-500">توزيع فعلي من جدول الشحنات</p>
              <MiniBars
                items={data.shipments.byStatus.map((row) => ({ label: statusLabel(row.status), value: row.count }))}
                emptyLabel="لا توجد شحنات مسجلة بعد."
              />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-sm font-bold text-navy">حالة الخدمة</h2>
              <p className="mb-4 mt-1 text-xs text-slate-500">فحص داخلي، وليس مراقبة خارجية</p>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">واجهة API</dt>
                  <dd className="font-semibold text-green-700">تعمل</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">قاعدة البيانات</dt>
                  <dd className={`font-semibold ${data.health.database === "connected" ? "text-green-700" : "text-red-700"}`}>
                    {data.health.database === "connected" ? "متصلة" : "غير متاحة"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">وضع التخزين</dt>
                  <dd className="font-semibold text-slate-700">
                    {data.health.persistenceMode === "database" ? "PostgreSQL" : data.health.persistenceMode}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-slate-500">
                لوحة الإدارة لا تعمل إلا مع PostgreSQL. التخزين المؤقت في الذاكرة غير مدعوم للإدارة.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-sm font-bold text-navy">اختصارات</h2>
              <p className="mb-4 mt-1 text-xs text-slate-500">المهام المتكررة</p>
              <div className="space-y-2 text-sm">
                {[
                  { href: "/admin/verifications", label: "مراجعة التحققات المعلّقة" },
                  { href: "/admin/users", label: "إدارة المستخدمين والصلاحيات" },
                  { href: "/admin/reports", label: "تقارير العمليات" },
                  { href: "/admin/audit-logs", label: "سجل التدقيق" }
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-slate-600 hover:border-primary/40 hover:text-primary"
                  >
                    <span>{link.label}</span>
                    <span aria-hidden="true">←</span>
                  </Link>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-navy">أحدث الإجراءات الإدارية</h2>
                <p className="mt-1 text-xs text-slate-500">سجل غير قابل للتعديل من واجهة الإدارة</p>
              </div>
              <Link href="/admin/audit-logs" className="text-xs font-semibold text-primary hover:underline">
                عرض السجل الكامل
              </Link>
            </div>

            {!data.recentAuditVisible && (
              <p className="px-5 py-6 text-sm text-slate-500">سجل التدقيق غير متاح لدورك الحالي.</p>
            )}

            {data.recentAuditVisible && data.recentAudit.length === 0 && (
              <p className="px-5 py-6 text-sm text-slate-500">لا توجد إجراءات مسجلة بعد.</p>
            )}

            {data.recentAuditVisible && data.recentAudit.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-canvas/80">
                    <tr>
                      {["الإجراء", "الكيان", "المنفّذ", "النتيجة", "الوقت"].map((header) => (
                        <th key={header} className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold text-slate-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentAudit.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-5 py-3 font-medium text-slate-700">{auditActionLabel(entry.action)}</td>
                        <td className="px-5 py-3 text-slate-500">{entityLabel(entry.entityType)}</td>
                        <td className="px-5 py-3 text-slate-500">{entry.actorRole ?? "نظام"}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              entry.outcome === "success"
                                ? "bg-green-100 text-green-800"
                                : entry.outcome === "denied"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-red-100 text-red-800"
                            }`}
                          >
                            {statusLabel(entry.outcome)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPageHeader, ErrorPanel, LoadingPanel, StatusBadge } from "@/components/admin/ui";
import { COMPANY_TYPE_LABEL, formatDate, formatMoney, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface QuotationDetail {
  quote: {
    id: string;
    rfqId: string | null;
    organizationId: string;
    currency: string;
    totalAmount: number | string;
    transitDays: number;
    validityUntil: string;
    status: string;
    createdAt: string;
    company: { id: string; name: string; type: string; verificationStatus: string; country: string | null } | null;
    items: { id: string; label: string; amount: number | string; currency: string; included: boolean }[];
    rfq: {
      id: string;
      organizationId: string;
      origin: string;
      destination: string;
      mode: string;
      status: string;
      cargoDescription: string;
      weightKg: number | string;
      createdAt: string;
    } | null;
    bookings: { id: string; status: string; createdAt: string; confirmedAt: string | null; externalReference: string | null }[];
  };
  rfqOrganization: { id: string; name: string } | null;
}

export default function AdminQuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, loading, error, reload } = useAdminResource<QuotationDetail>(id ? `/api/v1/admin/quotations/${id}` : null);

  return (
    <div>
      <AdminPageHeader
        title={data?.quote.company?.name ? `عرض ${data.quote.company.name}` : "تفاصيل عرض السعر"}
        description="تفاصيل العرض وبنوده والطلب المرتبط. للقراءة فقط؛ قبول العرض أو رفضه من صلاحيات العميل."
        action={
          <Link href="/admin/quotations" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            ← العودة للعروض
          </Link>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل العرض..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={data.quote.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {COMPANY_TYPE_LABEL[data.quote.company?.type ?? ""] ?? data.quote.company?.type ?? "مزود خدمة"}
              </span>
              {data.quote.company && <StatusBadge value={data.quote.company.verificationStatus} />}
              <span className="ltr-text rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{data.quote.id}</span>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">الإجمالي</dt>
                <dd className="mt-1 text-lg font-bold text-navy">{formatMoney(data.quote.totalAmount, data.quote.currency)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">مدة العبور</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.quote.transitDays} يوم</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">صالح حتى</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.quote.validityUntil)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ التقديم</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.quote.createdAt)}</dd>
              </div>
            </dl>

            {data.quote.company?.country && (
              <p className="mt-4 text-xs text-slate-500">بلد المزود: {data.quote.company.country}</p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">بنود العرض</h3>
                <p className="mt-1 text-xs text-slate-500">{data.quote.items.length} بند</p>
              </div>
              {data.quote.items.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد بنود مسجلة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.quote.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="text-slate-600">
                        {item.label} {item.included ? "" : <span className="text-xs text-amber-700">(غير مشمول)</span>}
                      </span>
                      <span className="whitespace-nowrap font-medium text-slate-700">{formatMoney(item.amount, item.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">الطلب المرتبط</h3>
              </div>
              {!data.quote.rfq ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا يوجد طلب عرض مرتبط.</p>
              ) : (
                <div className="px-5 py-4">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-slate-500">العميل</dt>
                      <dd className="mt-1 font-medium text-slate-700">{data.rfqOrganization?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">المسار</dt>
                      <dd className="mt-1 font-medium text-slate-700">
                        {data.quote.rfq.origin} ← {data.quote.rfq.destination}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">النمط</dt>
                      <dd className="mt-1 font-medium text-slate-700">{data.quote.rfq.mode}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">الوزن</dt>
                      <dd className="mt-1 font-medium text-slate-700">{formatNumber(Number(data.quote.rfq.weightKg))} كغ</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">حالة الطلب</dt>
                      <dd className="mt-1">
                        <StatusBadge value={data.quote.rfq.status} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">تاريخ الطلب</dt>
                      <dd className="mt-1 font-medium text-slate-700">{formatDate(data.quote.rfq.createdAt)}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-slate-600">{data.quote.rfq.cargoDescription}</p>
                  <Link
                    href={`/admin/rfqs/${data.quote.rfq.id}`}
                    className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
                  >
                    عرض طلب العرض كاملاً ←
                  </Link>
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">الحجوزات الناتجة</h3>
            </div>
            {data.quote.bookings.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لم ينتج عن هذا العرض أي حجز.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.quote.bookings.map((booking) => (
                  <li key={booking.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <Link href={`/admin/bookings/${booking.id}`} className="ltr-text font-medium text-slate-700 hover:text-primary">
                        {booking.id.slice(0, 14)}…
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDate(booking.createdAt)} {booking.externalReference ? `· ${booking.externalReference}` : ""}
                      </p>
                    </div>
                    <StatusBadge value={booking.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

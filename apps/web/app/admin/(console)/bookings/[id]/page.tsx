"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPageHeader, ErrorPanel, LoadingPanel, StatusBadge } from "@/components/admin/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface BookingDetail {
  booking: {
    id: string;
    status: string;
    organizationId: string;
    createdByUserId: string;
    confirmedAt: string | null;
    externalReference: string | null;
    rejectionReason: string | null;
    createdAt: string;
    updatedAt: string;
    rfq: {
      id: string;
      origin: string;
      destination: string;
      mode: string;
      status: string;
      cargoDescription: string;
      weightKg: number | string;
      organizationId: string;
      createdAt: string;
    } | null;
    quote: {
      id: string;
      currency: string;
      totalAmount: number | string;
      transitDays: number;
      validityUntil: string;
      status: string;
      createdAt: string;
      company: { id: string; name: string; type: string; verificationStatus: string } | null;
      items: { id: string; label: string; amount: number | string; currency: string; included: boolean }[];
    } | null;
    trackingEvents: { id: string; code: string; label: string; source: string; occurredAt: string }[];
  };
  organization: { id: string; name: string; slug: string } | null;
}

export default function AdminBookingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, loading, error, reload } = useAdminResource<BookingDetail>(id ? `/api/v1/admin/bookings/${id}` : null);

  return (
    <div>
      <AdminPageHeader
        title="تفاصيل الحجز"
        description="ملخص الحجز والعرض المرتبط وأحداث التتبع. للقراءة فقط من لوحة الإدارة."
        action={
          <Link href="/admin/bookings" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            ← العودة للحجوزات
          </Link>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل الحجز..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={data.booking.status} />
              <span className="ltr-text rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{data.booking.id}</span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">العميل</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.organization?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ الطلب</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.booking.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ التأكيد</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.booking.confirmedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">المرجع الخارجي</dt>
                <dd className="ltr-text mt-1 font-medium text-slate-700">{data.booking.externalReference ?? "—"}</dd>
              </div>
            </dl>
            {data.booking.rejectionReason && (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800">سبب الرفض: {data.booking.rejectionReason}</p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">طلب العرض</h3>
              </div>
              {!data.booking.rfq ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا يوجد طلب عرض مرتبط.</p>
              ) : (
                <dl className="space-y-3 px-5 py-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">المسار</dt>
                    <dd className="text-left font-medium text-slate-700">
                      {data.booking.rfq.origin} ← {data.booking.rfq.destination}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">النمط</dt>
                    <dd className="font-medium text-slate-700">{data.booking.rfq.mode}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">الوزن</dt>
                    <dd className="font-medium text-slate-700">{formatNumber(Number(data.booking.rfq.weightKg))} كغ</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">وصف البضاعة</dt>
                    <dd className="mt-1 text-slate-700">{data.booking.rfq.cargoDescription}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">حالة الطلب</dt>
                    <dd>
                      <StatusBadge value={data.booking.rfq.status} />
                    </dd>
                  </div>
                </dl>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">العرض المقبول</h3>
              </div>
              {!data.booking.quote ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا يوجد عرض مرتبط.</p>
              ) : (
                <div className="px-5 py-4">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-slate-500">المزود</dt>
                      <dd className="mt-1 font-medium text-slate-700">{data.booking.quote.company?.name ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">الإجمالي</dt>
                      <dd className="mt-1 font-medium text-slate-700">
                        {formatMoney(data.booking.quote.totalAmount, data.booking.quote.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">مدة العبور</dt>
                      <dd className="mt-1 font-medium text-slate-700">{data.booking.quote.transitDays} يوم</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">صالح حتى</dt>
                      <dd className="mt-1 font-medium text-slate-700">{formatDate(data.booking.quote.validityUntil)}</dd>
                    </div>
                  </dl>
                  {data.booking.quote.items.length > 0 && (
                    <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {data.booking.quote.items.map((item) => (
                        <li key={item.id} className="flex items-center justify-between px-3 py-2 text-xs">
                          <span className="text-slate-600">
                            {item.label} {item.included ? "" : "(غير مشمول)"}
                          </span>
                          <span className="font-medium text-slate-700">{formatMoney(item.amount, item.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">أحداث التتبع</h3>
              <p className="mt-1 text-xs text-slate-500">أحداث يدوية أو مصدرية مسجلة على الحجز</p>
            </div>
            {data.booking.trackingEvents.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لا توجد أحداث تتبع.</p>
            ) : (
              <ol className="divide-y divide-slate-100">
                {data.booking.trackingEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-700">{event.label}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {event.code} · المصدر: {event.source}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(event.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

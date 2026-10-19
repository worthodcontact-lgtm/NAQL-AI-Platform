"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPageHeader, ErrorPanel, LoadingPanel, StatusBadge } from "@/components/admin/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface RfqDetail {
  rfq: {
    id: string;
    organizationId: string;
    createdByUserId: string;
    origin: string;
    destination: string;
    mode: string;
    cargoDescription: string;
    weightKg: number | string;
    status: string;
    createdAt: string;
    updatedAt: string;
    recipients: {
      id: string;
      status: string;
      invitedAt: string;
      company: { id: string; name: string; type: string; verificationStatus: string } | null;
    }[];
    quotes: {
      id: string;
      currency: string;
      totalAmount: number | string;
      transitDays: number;
      validityUntil: string;
      status: string;
      createdAt: string;
      organizationId: string;
      company: { id: string; name: string; verificationStatus: string } | null;
      items: { id: string; label: string; amount: number | string; currency: string; included: boolean }[];
    }[];
    bookings: { id: string; status: string; createdAt: string; confirmedAt: string | null; externalReference: string | null }[];
  };
  organization: { id: string; name: string; slug: string } | null;
}

export default function AdminRfqDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, loading, error, reload } = useAdminResource<RfqDetail>(id ? `/api/v1/admin/rfqs/${id}` : null);

  return (
    <div>
      <AdminPageHeader
        title={data ? `${data.rfq.origin} ← ${data.rfq.destination}` : "تفاصيل طلب العرض"}
        description="بيانات الطلب والمزودون المدعوون والعروض المستلمة والحجوزات الناتجة. لا يمكن تعديل الطلب من لوحة الإدارة."
        action={
          <Link href="/admin/rfqs" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            ← العودة للطلبات
          </Link>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل طلب العرض..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={data.rfq.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{data.rfq.mode}</span>
              <span className="ltr-text rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{data.rfq.id}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{data.rfq.cargoDescription}</p>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">العميل</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.organization?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الوزن</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatNumber(Number(data.rfq.weightKg))} كغ</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ الإنشاء</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.rfq.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">آخر تحديث</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.rfq.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">المزودون المدعوون</h3>
                <p className="mt-1 text-xs text-slate-500">{data.rfq.recipients.length} مزود</p>
              </div>
              {data.rfq.recipients.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا يوجد مزودون مدعوون.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.rfq.recipients.map((recipient) => (
                    <li key={recipient.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-700">{recipient.company?.name ?? "—"}</p>
                        <p className="mt-0.5 text-xs text-slate-500">دُعي في {formatDate(recipient.invitedAt)}</p>
                      </div>
                      <StatusBadge value={recipient.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">الحجوزات</h3>
                <p className="mt-1 text-xs text-slate-500">{data.rfq.bookings.length} حجز</p>
              </div>
              {data.rfq.bookings.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد حجوزات مرتبطة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.rfq.bookings.map((booking) => (
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

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">العروض المستلمة</h3>
              <p className="mt-1 text-xs text-slate-500">{data.rfq.quotes.length} عرض · القيم كما سجلها المزود</p>
            </div>
            {data.rfq.quotes.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لم تُستلم عروض بعد.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-canvas/80">
                    <tr>
                      {["المزود", "الإجمالي", "مدة العبور", "صالح حتى", "الحالة", "الوقت", ""].map((header) => (
                        <th key={header} className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold text-slate-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rfq.quotes.map((quote) => (
                      <tr key={quote.id}>
                        <td className="px-5 py-3 text-slate-700">{quote.company?.name ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-700">
                          {formatMoney(quote.totalAmount, quote.currency)}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600">{quote.transitDays} يوم</td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDate(quote.validityUntil)}</td>
                        <td className="px-5 py-3">
                          <StatusBadge value={quote.status} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDate(quote.createdAt)}</td>
                        <td className="whitespace-nowrap px-5 py-3">
                          <Link href={`/admin/quotations/${quote.id}`} className="text-xs font-semibold text-primary hover:underline">
                            تفاصيل ←
                          </Link>
                        </td>
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

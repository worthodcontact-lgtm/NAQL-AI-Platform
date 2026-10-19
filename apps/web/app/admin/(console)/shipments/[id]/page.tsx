"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AdminPageHeader, ErrorPanel, LoadingPanel, StatusBadge } from "@/components/admin/ui";
import { formatDate, formatMoney, formatNumber } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface ShipmentDetail {
  shipment: {
    id: string;
    reference: string;
    organizationId: string;
    organization: { id: string; name: string; slug: string } | null;
    createdByUserId: string;
    mode: string;
    incoterm: string;
    status: string;
    cargoDescription: string;
    weightKg: number | string;
    volumeCbm: number | string | null;
    createdAt: string;
    updatedAt: string;
    originPort: { id: string; code: string; name: string; country: string; type: string } | null;
    destinationPort: { id: string; code: string; name: string; country: string; type: string } | null;
    milestones: { id: string; code: string; label: string; status: string; occurredAt: string | null }[];
    documents: { id: string; type: string; filename: string; status: string; validation: string | null; uploadedAt: string }[];
    quotationRequests: {
      id: string;
      status: string;
      requestedAt: string;
      offers: { id: string; providerId: string; currency: string; amount: number | string; transitDays: number; validityUntil: string }[];
    }[];
  };
}

export default function AdminShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { data, loading, error, reload } = useAdminResource<ShipmentDetail>(id ? `/api/v1/admin/shipments/${id}` : null);

  return (
    <div>
      <AdminPageHeader
        title={data?.shipment.reference ?? "تفاصيل الشحنة"}
        description="عرض للقراءة فقط. أي تعديل تشغيلي يتم من واجهة العميل أو مزود الخدمة وفق صلاحياته."
        action={
          <Link href="/admin/shipments" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            ← العودة للشحنات
          </Link>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل الشحنة..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={data.shipment.status} />
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {data.shipment.mode} · {data.shipment.incoterm}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{data.shipment.cargoDescription}</p>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">المنظمة</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.shipment.organization?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الوزن</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatNumber(Number(data.shipment.weightKg))} كغ</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الحجم</dt>
                <dd className="mt-1 font-medium text-slate-700">
                  {data.shipment.volumeCbm === null ? "—" : `${formatNumber(Number(data.shipment.volumeCbm))} م³`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ الإنشاء</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.shipment.createdAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">ميناء Origin</dt>
                <dd className="mt-1 font-medium text-slate-700">
                  {data.shipment.originPort ? `${data.shipment.originPort.name} · ${data.shipment.originPort.code} · ${data.shipment.originPort.country}` : "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500">ميناء Destination</dt>
                <dd className="mt-1 font-medium text-slate-700">
                  {data.shipment.destinationPort
                    ? `${data.shipment.destinationPort.name} · ${data.shipment.destinationPort.code} · ${data.shipment.destinationPort.country}`
                    : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">مراحل الشحنة</h3>
              </div>
              {data.shipment.milestones.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد مراحل مسجلة.</p>
              ) : (
                <ol className="divide-y divide-slate-100">
                  {data.shipment.milestones.map((milestone) => (
                    <li key={milestone.id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{milestone.label}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{milestone.code}</p>
                      </div>
                      <div className="text-left">
                        <StatusBadge value={milestone.status} />
                        <p className="mt-1 text-[11px] text-slate-400">{formatDate(milestone.occurredAt)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">الوثائق</h3>
              </div>
              {data.shipment.documents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد وثائق.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.shipment.documents.map((document) => (
                    <li key={document.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-700">{document.filename}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {document.type} · {formatDate(document.uploadedAt)}
                        </p>
                      </div>
                      <StatusBadge value={document.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">طلبات عروض مرتبطة</h3>
              <p className="mt-1 text-xs text-slate-500">العروض المرتبطة بالشحنة، دون تعديل</p>
            </div>
            {data.shipment.quotationRequests.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لا توجد طلبات عروض.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.shipment.quotationRequests.map((request) => (
                  <li key={request.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700">طلب {request.id}</span>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={request.status} />
                        <span className="text-xs text-slate-500">{formatDate(request.requestedAt)}</span>
                      </div>
                    </div>
                    {request.offers.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">لا توجد عروض بعد.</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-100 text-xs">
                          <thead>
                            <tr>
                              {["المزود", "المبلغ", "مدة العبور", "صالح حتى"].map((header) => (
                                <th key={header} className="px-2 py-2 text-right font-semibold text-slate-500">
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {request.offers.map((offer) => (
                              <tr key={offer.id}>
                                <td className="ltr-text px-2 py-2 text-slate-600">{offer.providerId}</td>
                                <td className="px-2 py-2 text-slate-700">{formatMoney(offer.amount, offer.currency)}</td>
                                <td className="px-2 py-2 text-slate-600">{offer.transitDays} يوم</td>
                                <td className="px-2 py-2 text-slate-500">{formatDate(offer.validityUntil)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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

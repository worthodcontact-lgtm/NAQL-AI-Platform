"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, downloadFile } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

const RFQ_STATUS: Record<string, string> = {
  submitted: "مفتوح للعروض",
  accepted: "تم اختيار عرض",
  cancelled: "ملغي",
  rejected: "مرفوض",
  draft: "مسودة"
};

const QUOTE_STATUS: Record<string, string> = {
  submitted: "مقدَّم",
  accepted: "مقبول",
  rejected: "مرفوض",
  withdrawn: "مسحوب",
  expired: "منتهي"
};

const PRICING_SOURCE_LABEL: Record<string, string> = {
  provider_submitted: "سعر قدمه المزود",
  published_tariff: "تعريفة منشورة (حسب مرجع المزود)",
  estimated: "سعر تقديري",
  calculated: "سعر محسوب",
  contracted: "سعر تعاقدي حسب إفادة المزود"
};

const CONFIDENCE_LABEL: Record<string, string> = {
  indicative: "استرشادي",
  estimated: "تقديري",
  confirmed: "مؤكد من المزود — غير متحقق خارجياً"
};

const CHARGE_TYPE_LABEL: Record<string, string> = {
  freight: "أجرة نقل",
  surcharge: "رسم إضافي",
  fee: "رسوم",
  service: "خدمة",
  tax: "ضريبة",
  other: "أخرى"
};

const ACTIVITY_LABEL: Record<string, string> = {
  RFQ_CREATED: "إنشاء الطلب",
  RFQ_CANCELLED: "إلغاء الطلب",
  QUOTE_SUBMITTED: "عرض سعر",
  QUOTE_WITHDRAWN: "سحب عرض",
  QUOTE_ACCEPTED: "قبول عرض",
  QUOTE_REJECTED: "رفض عرض",
  BOOKING_REQUESTED: "طلب حجز",
  BOOKING_CONFIRMED: "تأكيد حجز",
  BOOKING_REJECTED: "رفض حجز",
  BOOKING_CANCELLED: "إلغاء حجز",
  SHIPMENT_UPDATE: "تحديث شحنة"
};

function quoteVariant(status: string): "success" | "warning" | "error" | "neutral" | "info" {
  if (status === "accepted") return "success";
  if (status === "rejected" || status === "expired") return "error";
  if (status === "withdrawn") return "neutral";
  return "info";
}

function money(value: unknown, currency: string) {
  const numeric = Number(value);
  return `${Number.isFinite(numeric) ? numeric.toLocaleString("en-US") : "0"} ${currency}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
    reader.readAsDataURL(file);
  });
}

export default function RfqDetailsPage() {
  const params = useParams<{ id: string }>();
  const [rfq, setRfq] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [acceptedBooking, setAcceptedBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("commercial_invoice");
  const [documentVisibility, setDocumentVisibility] = useState("providers");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [detail, timeline] = await Promise.all([
        apiFetch(`/api/v1/rfqs/${params.id}`),
        apiFetch(`/api/v1/rfqs/${params.id}/activity`).catch(() => ({ items: [] }))
      ]);
      setRfq(detail);
      setActivity(timeline.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الطلب.");
    } finally {
      setLoading(false);
    }
  }

  async function accept(quoteId: string) {
    if (
      !window.confirm(
        "سيتم اختيار هذا العرض ورفض بقية العروض تلقائياً، ثم إنشاء طلب حجز. الحجز لن يكون مؤكداً حتى تأكيد المزود. المتابعة؟"
      )
    ) {
      return;
    }
    setAccepting(quoteId);
    setError("");
    try {
      const res = await apiFetch(`/api/v1/rfqs/${params.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ quoteId })
      });
      setAcceptedBooking(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر قبول العرض.");
    } finally {
      setAccepting("");
    }
  }

  async function submitDraft() {
    setBusy("submit");
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/rfqs/${params.id}/submit`, { method: "POST", body: JSON.stringify({}) });
      setNotice("تم إرسال الطلب إلى المزودين المدعوين.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال المسودة.");
    } finally {
      setBusy("");
    }
  }

  async function cancelRfq() {
    const reason = window.prompt("سبب إلغاء طلب العرض (مطلوب):");
    if (!reason || reason.trim().length < 3) return;
    setBusy("cancel");
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/rfqs/${params.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      setNotice("تم إلغاء الطلب وتسجيل السبب. العروض المفتوحة رُفضت.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إلغاء الطلب.");
    } finally {
      setBusy("");
    }
  }

  async function uploadDocument() {
    if (!file) return;
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setError("يُسمح فقط بملفات PDF أو PNG أو JPEG.");
      return;
    }
    setBusy("document");
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/rfqs/${params.id}/documents`, {
        method: "POST",
        body: JSON.stringify({
          type: documentType,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          visibility: documentVisibility,
          dataBase64: await fileToBase64(file)
        })
      });
      setFile(null);
      setNotice("تم رفع المستند. المستندات الخاصة لا تظهر للمزودين.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع المستند.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const quotes = useMemo(
    () =>
      [...(rfq?.quotes ?? [])].sort((a: any, b: any) => Number(a.totalAmount) - Number(b.totalAmount)),
    [rfq?.quotes]
  );

  if (loading) return <Skeleton className="h-64" />;
  if (error && !rfq) return <p className="text-error">{error}</p>;
  if (!rfq) return <EmptyState title="غير موجود" description="تعذر العثور على الطلب." />;

  const booking = acceptedBooking ?? rfq.bookings?.[0] ?? null;
  const isOwner = rfq.viewerRole === "owner" || (!rfq.viewerRole && Boolean(rfq.organizationId));
  const canAccept = isOwner && rfq.status === "submitted";
  const acceptedQuote = quotes.find((quote: any) => quote.status === "accepted");
  const shipmentId = booking?.shipmentId ?? rfq.shipmentId ?? null;
  const documents = rfq.documents ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rfqs" className="text-xs text-slate-500 hover:text-primary">← طلبات العروض</Link>
        <h1 className="mt-1 text-2xl font-bold text-navy">{rfq.origin} → {rfq.destination}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {rfq.mode} · {rfq.cargoDescription} · {rfq.weightKg} kg ·{" "}
          <Badge variant={rfq.status === "accepted" ? "success" : rfq.status === "submitted" ? "info" : "neutral"}>
            {RFQ_STATUS[rfq.status] ?? rfq.status}
          </Badge>
          {rfq.discoveryMode === "marketplace" ? (
            <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">سوق مفتوح</span>
          ) : null}
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-dark">{notice}</div>
      ) : null}

      <Card>
        <CardHeader title="بيانات الطلب" subtitle="الحقول التقريبية لا تُفسر كبيانات مؤكدة. تقارير المقارنة تعرض المصدر والثقة." />
        <div className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><p className="text-xs text-slate-400">الخدمة المطلوبة</p><p className="text-slate-700">{rfq.requiredService ?? "غير محددة"}</p></div>
          <div><p className="text-xs text-slate-400">الحجم التقريبي</p><p className="text-slate-700">{rfq.volumeCbm ? `${rfq.volumeCbm} CBM` : "غير محدد"}</p></div>
          <div><p className="text-xs text-slate-400">الطرود / الحاويات</p><p className="text-slate-700">{rfq.packageCount ?? "—"} / {rfq.containerCount ?? "—"} {rfq.containerType ? `(${rfq.containerType})` : ""}</p></div>
          <div><p className="text-xs text-slate-400">الاستلام / التسليم</p><p className="text-slate-700">{rfq.preferredPickupDate ? String(rfq.preferredPickupDate).slice(0, 10) : "—"} → {rfq.preferredDeliveryDate ? String(rfq.preferredDeliveryDate).slice(0, 10) : "—"}</p></div>
          <div><p className="text-xs text-slate-400">آخر موعد للتسليم</p><p className="text-slate-700">{rfq.latestDeliveryDate ? String(rfq.latestDeliveryDate).slice(0, 10) : "غير محدد"}</p></div>
          <div><p className="text-xs text-slate-400">قيمة البضاعة</p><p className="text-slate-700">{rfq.cargoValue ? `${rfq.cargoValue} ${rfq.cargoCurrency ?? ""}` : "غير محددة"}</p></div>
          <div><p className="text-xs text-slate-400">بضاعة خطرة</p><p className="text-slate-700">{rfq.isHazardous ? "نعم" : "لا"}</p></div>
          <div><p className="text-xs text-slate-400">شرط التسليم</p><p className="text-slate-700">{rfq.incoterm ?? "—"}</p></div>
          <div><p className="text-xs text-slate-400">متطلبات خاصة</p><p className="text-slate-700">{rfq.specialRequirements ?? "لا توجد"}</p></div>
        </div>
        {isOwner && (rfq.status === "draft" || rfq.status === "submitted") ? (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 p-5">
            {rfq.status === "draft" ? (
              <Button isLoading={busy === "submit"} onClick={() => void submitDraft()}>إرسال المسودة للمزودين</Button>
            ) : null}
            <Button variant="secondary" isLoading={busy === "cancel"} onClick={() => void cancelRfq()}>
              إلغاء الطلب
            </Button>
          </div>
        ) : null}
        {rfq.cancellationReason ? (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-red-700">
            سبب الإلغاء: {rfq.cancellationReason}
          </p>
        ) : null}
      </Card>

      {(booking || acceptedQuote) ? (
        <Card>
          <CardHeader
            title="قرار العرض"
            subtitle="لا يمكن قبول أكثر من عرض واحد. العروض الأخرى تُرفض تلقائياً مع تسجيل الوقت والمنفّذ. طلب الحجز ليس حجزاً مؤكداً لدى الناقل الخارجي."
          />
          <div className="space-y-2 p-5 text-sm">
            {acceptedQuote ? (
              <p>
                العرض المقبول: <span className="ltr-text font-semibold">{money(acceptedQuote.totalAmount, acceptedQuote.currency)}</span>
                {" · "}{acceptedQuote.transitDays} يوم
              </p>
            ) : null}
            {booking ? (
              <p>
                طلب الحجز: <span className="ltr-text font-mono">{booking.id}</span> · الحالة:{" "}
                {booking.status === "requested" ? "بانتظار تأكيد المزود" : booking.status}
                {booking.alreadyAccepted ? " · هذه إعادة محاولة لنفس القبول" : ""}
              </p>
            ) : null}
            {shipmentId ? (
              <p>
                الشحنة المرتبطة:{" "}
                <Link href={`/shipments/${shipmentId}`} className="font-medium text-primary">
                  فتح الشحنة
                </Link>
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              الحجز داخل NAQL AI لا يُنشئ حجزاً لدى خط ملاحي أو ناقل خارجي. لا يوجد تكامل حجز/تتبع مباشر
              مؤكد في هذا الإصدار.
            </p>
            <Link href="/bookings" className="inline-block font-medium text-primary">متابعة الحجوزات</Link>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="مقارنة العروض الواردة"
          subtitle="العروض ليست مجرد سعر. تظهر الرسوم المستبعدة والاختيارية والتقديرية والمجهولة ومصدر التسعير. الترتيب بالسعر لا يعني التوصية."
        />
        <div className="space-y-3 p-5">
          {quotes.length === 0 ? <p className="text-sm text-slate-500">لا توجد عروض بعد.</p> : null}
          {quotes.map((q: any) => {
            const expired = new Date(q.validityUntil).getTime() <= Date.now();
            const acceptable = canAccept && q.status === "submitted" && !expired;
            const hasEstimates = Boolean(q.hasEstimatedComponents) || q.priceConfidence === "estimated";
            const knownSubtotal = Number(q.knownSubtotal ?? q.totalAmount ?? 0);
            const excludedSubtotal = Number(q.excludedSubtotal ?? 0);
            return (
              <div key={q.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="ltr-text font-semibold text-navy">
                        {money(q.totalAmount, q.currency)}
                      </p>
                      <Badge variant={quoteVariant(expired && q.status === "submitted" ? "expired" : q.status)}>
                        {expired && q.status === "submitted" ? "منتهي" : QUOTE_STATUS[q.status] ?? q.status}
                      </Badge>
                      {hasEstimates ? <Badge variant="warning">يشمل تقديرات</Badge> : null}
                      {q.hasUnknownCharges ? <Badge variant="warning">رسوم غير معروفة</Badge> : null}
                      {Number(q.revisionNumber ?? 1) > 1 ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">نسخة {q.revisionNumber}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      مدة العبور: {q.transitDays} يوم · صالح حتى:{" "}
                      <span className="ltr-text">{String(q.validityUntil).slice(0, 10)}</span>
                      {" · "}شركة:{" "}
                      <span className="font-medium text-slate-700">
                        {q.company?.name ?? q.companyId}
                      </span>
                      {q.company?.verificationStatus ? (
                        <span className="ms-2 inline-block align-middle">
                          <Badge variant={q.company.verificationStatus === "verified" ? "success" : "warning"}>
                            {q.company.verificationStatus === "verified" ? "موثّقة" : "غير موثّقة"}
                          </Badge>
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      المصدر: {PRICING_SOURCE_LABEL[q.pricingSource] ?? q.pricingSource ?? "غير محدد"} · الثقة:{" "}
                      {CONFIDENCE_LABEL[q.priceConfidence] ?? q.priceConfidence ?? "غير محددة"}
                    </p>
                    {knownSubtotal !== Number(q.totalAmount) ? (
                      <p className="mt-1 text-xs text-slate-500">
                        المجموع المعروف للبنود المضمنة: {money(knownSubtotal, q.currency)}
                        {excludedSubtotal > 0 ? ` · مستبعد/اختياري: ${money(excludedSubtotal, q.currency)}` : ""}
                      </p>
                    ) : null}
                    {q.rejectionReason ? (
                      <p className="mt-1 text-xs text-red-700">سبب الرفض/السحب: {q.rejectionReason}</p>
                    ) : null}
                  </div>
                  {acceptable ? (
                    <Button isLoading={accepting === q.id} onClick={() => void accept(q.id)}>
                      اختيار هذا العرض
                    </Button>
                  ) : null}
                </div>

                {Array.isArray(q.items) && q.items.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500">
                          <th className="py-2 text-start">البند</th>
                          <th className="py-2 text-start">النوع</th>
                          <th className="py-2 text-start">القيمة</th>
                          <th className="py-2 text-start">الحالة</th>
                          <th className="py-2 text-start">المصدر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.items.map((item: any) => (
                          <tr key={item.id ?? item.label} className="border-b border-slate-100">
                            <td className="py-2 text-slate-700">
                              {item.label}
                              {item.notes ? <p className="text-xs text-slate-400">{item.notes}</p> : null}
                            </td>
                            <td className="py-2 text-slate-600">{CHARGE_TYPE_LABEL[item.chargeType] ?? item.chargeType ?? "—"}</td>
                            <td className="ltr-text py-2 text-slate-700">{money(item.amount, item.currency)}</td>
                            <td className="py-2 text-slate-600">
                              {item.included === false ? "مستبعد" : item.optional ? "اختياري" : "مضمن"}
                              {item.pricingSource === "estimated" ? " · تقديري" : ""}
                            </td>
                            <td className="py-2 text-xs text-slate-500">
                              {PRICING_SOURCE_LABEL[item.pricingSource] ?? item.pricingSource ?? "—"}
                              {item.sourceReference ? <p className="ltr-text text-[11px] text-slate-400">{item.sourceReference}</p> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {q.unknownCharges?.length ? (
                  <p className="mt-2 text-xs text-amber-700">رسوم غير معروفة (لا تُحسب صفراً): {q.unknownCharges.join(" · ")}</p>
                ) : null}
                {q.excludedServices?.length ? (
                  <p className="mt-1 text-xs text-slate-500">خدمات مستبعدة: {q.excludedServices.join(" · ")}</p>
                ) : null}
                {q.serviceDetails ? <p className="mt-2 text-xs text-slate-600">الخدمة: {q.serviceDetails}</p> : null}
                {q.routeDetails ? <p className="mt-1 text-xs text-slate-600">المسار: {q.routeDetails}</p> : null}
                {q.terms ? <p className="mt-1 text-xs text-slate-500">الشروط: {q.terms}</p> : null}
                {q.notes ? <p className="mt-1 text-xs text-slate-500">ملاحظات: {q.notes}</p> : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="المستندات"
          subtitle="المستندات الخاصة لا تظهر للمزودين. مستندات المشاركة تظهر فقط للمزودين المدعوين أو المنضمين."
        />
        <div className="space-y-3 p-5">
          {documents.length === 0 ? (
            <p className="text-sm text-slate-500">لا توجد مستندات.</p>
          ) : (
            <ul className="space-y-2">
              {documents.map((document: any) => (
                <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <div>
                    <p className="font-medium text-navy">{document.filename}</p>
                    <p className="text-xs text-slate-500">
                      {document.type} · {document.visibility === "private" ? "خاص بالعميل" : "متاح للمزودين المدعوين"}
                      {document.size ? ` · ${Math.ceil(document.size / 1024)} KB` : ""} · فحص البرمجيات: {document.malwareScanStatus}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void downloadFile(`/api/v1/rfqs/${params.id}/documents/${document.id}`, document.filename)
                        .catch((err) => setError(err instanceof Error ? err.message : "تعذر تنزيل المستند."))
                    }
                  >
                    تنزيل
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {isOwner ? (
            <div className="rounded-xl border border-slate-200 bg-canvas/40 p-4">
              <p className="text-sm font-semibold text-navy">إضافة مستند داعم</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <select
                  aria-label="نوع مستند الطلب"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value)}
                >
                  <option value="commercial_invoice">فاتورة تجارية</option>
                  <option value="packing_list">قائمة تعبئة</option>
                  <option value="product_details">تفاصيل المنتج</option>
                  <option value="other">أخرى</option>
                </select>
                <select
                  aria-label="مشاركة المستند"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={documentVisibility}
                  onChange={(e) => setDocumentVisibility(e.target.value)}
                >
                  <option value="providers">مشاركة مع المزودين المختارين</option>
                  <option value="private">خاص بالعميل فقط</option>
                </select>
                <input
                  aria-label="ملف مستند الطلب"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm md:col-span-2"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                يُقبل PDF/PNG/JPEG فقط بعد التحقق من البصمة، والحد الأقصى وفق إعدادات الخادم. قد يكون فحص
                البرمجيات غير متاح؛ تظهر الحالة الفعلية.
              </p>
              <Button className="mt-3" size="sm" isLoading={busy === "document"} disabled={!file} onClick={() => void uploadDocument()}>
                رفع المستند
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="سجل النشاط" subtitle="أحداث محفوظة مع الوقت والمنفّذ عند السماح. لا يعرض للمزود عروض المنافسين." />
        <div className="p-5">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">لا يوجد نشاط مسجل بعد.</p>
          ) : (
            <ol className="space-y-3">
              {activity.map((event: any) => (
                <li key={event.id} className="border-s-2 border-slate-200 ps-3 text-sm">
                  <p className="font-medium text-navy">{ACTIVITY_LABEL[event.type] ?? event.type}</p>
                  <p className="text-xs text-slate-500">
                    {event.at ? new Date(event.at).toLocaleString("ar-EG") : ""}
                    {event.actor?.displayName ? ` · ${event.actor.displayName}` : ""}
                    {event.actor?.role === "customer" ? " · العميل" : event.actor?.role === "provider" ? " · المزود" : ""}
                  </p>
                  {event.summary ? <p className="mt-1 text-slate-600">{event.summary}</p> : null}
                  {event.reason ? <p className="text-xs text-red-700">السبب: {event.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}

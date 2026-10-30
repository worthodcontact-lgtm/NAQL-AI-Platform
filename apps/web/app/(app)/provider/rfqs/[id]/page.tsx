"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

type LineItem = {
  label: string;
  amount: number;
  currency: string;
  included: boolean;
  optional: boolean;
  chargeType: string;
  pricingSource: string;
  priceConfidence: string;
  sourceReference: string;
  notes: string;
};

const CURRENCIES = ["USD", "EUR", "EGP"];
const PRICING_SOURCES = [
  { value: "provider_submitted", label: "سعر قدمه المزود" },
  { value: "published_tariff", label: "تعريفة منشورة" },
  { value: "estimated", label: "تقديري" },
  { value: "calculated", label: "محسوب" },
  { value: "contracted", label: "تعاقدي حسب إفادة المزود" }
];
const CONFIDENCE_LEVELS = [
  { value: "indicative", label: "استرشادي" },
  { value: "estimated", label: "تقديري" },
  { value: "confirmed", label: "مؤكد من المزود" }
];
const CHARGE_TYPES = [
  { value: "freight", label: "أجرة نقل" },
  { value: "surcharge", label: "رسم إضافي" },
  { value: "fee", label: "رسوم" },
  { value: "service", label: "خدمة" },
  { value: "tax", label: "ضريبة" },
  { value: "other", label: "أخرى" }
];
const PRICING_SOURCE_LABEL = Object.fromEntries(PRICING_SOURCES.map((item) => [item.value, item.label]));
const CONFIDENCE_LABEL = Object.fromEntries(CONFIDENCE_LEVELS.map((item) => [item.value, item.label]));

const QUOTE_STATUS_LABEL: Record<string, string> = {
  submitted: "مقدَّم",
  accepted: "مقبول",
  rejected: "مرفوض",
  withdrawn: "مسحوب",
  expired: "منتهي"
};

function defaultValidity() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

/**
 * Provider quotation editor.
 *
 * The company selector is limited to companies the signed-in organization actually owns,
 * as reported by the API. The API re-checks ownership on submission, so the list is a
 * convenience and never the authorization boundary.
 */
export default function ProviderRfqDetailPage() {
  const params = useParams<{ id: string }>();

  const [rfq, setRfq] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [withdrawing, setWithdrawing] = useState("");
  const [success, setSuccess] = useState("");

  const [companyId, setCompanyId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [transitDays, setTransitDays] = useState(14);
  const [validityUntil, setValidityUntil] = useState(defaultValidity());
  const [pricingSource, setPricingSource] = useState("provider_submitted");
  const [priceConfidence, setPriceConfidence] = useState("indicative");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [serviceDetails, setServiceDetails] = useState("");
  const [routeDetails, setRouteDetails] = useState("");
  const [unknownCharges, setUnknownCharges] = useState("");
  const [excludedServices, setExcludedServices] = useState("");
  const [items, setItems] = useState<LineItem[]>([
    {
      label: "أجرة الشحن", amount: 0, currency: "USD", included: true, optional: false,
      chargeType: "freight", pricingSource: "provider_submitted", priceConfidence: "indicative",
      sourceReference: "", notes: ""
    },
    {
      label: "رسوم الميناء", amount: 0, currency: "USD", included: true, optional: false,
      chargeType: "fee", pricingSource: "provider_submitted", priceConfidence: "indicative",
      sourceReference: "", notes: ""
    }
  ]);

  const total = useMemo(
    () =>
      items
        .filter((i) => i.included && !i.optional)
        .reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
    [items]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [rfqRes, mineRes] = await Promise.all([
        apiFetch(`/api/v1/rfqs/${params.id}`),
        apiFetch("/api/v1/companies/mine")
      ]);
      setRfq(rfqRes);
      const mine = mineRes.items ?? [];
      setCompanies(mine);

      // Prefer a company that was actually invited to this RFQ.
      const recipientIds = new Set((rfqRes.recipients ?? []).map((r: any) => r.companyId));
      const invited = mine.filter((c: any) => recipientIds.has(c.id));
      const options = invited.length > 0 ? invited : mine;
      if (options.length > 0) setCompanyId((current) => current || options[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الطلب.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function withdraw(quoteId: string) {
    if (!window.confirm("سحب العرض نهائياً؟ لا يمكن التراجع عن السحب.")) return;
    setWithdrawing(quoteId);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/api/v1/rfqs/${params.id}/quotes/${quoteId}/withdraw`, { method: "POST" });
      setSuccess("تم سحب العرض وتسجيل ذلك في السجل.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر سحب العرض.");
    } finally {
      setWithdrawing("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!companyId) {
      setError("اختر الشركة التي تقدّم العرض.");
      return;
    }
    const validItems = items
      .filter((i) => i.label.trim() && Number(i.amount) >= 0)
      .map((i) => ({
        label: i.label.trim(),
        amount: Number(i.amount),
        currency,
        included: i.included,
        optional: i.optional,
        chargeType: i.chargeType,
        pricingSource: i.pricingSource,
        priceConfidence: i.priceConfidence,
        sourceReference: i.sourceReference || undefined,
        notes: i.notes || undefined
      }));
    if (!validItems.some((item) => item.included && !item.optional && item.amount > 0)) {
      setError("أضف بنداً واحداً على الأقل مضمنًا وغير اختياري بقيمة أكبر من صفر.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/api/v1/rfqs/${params.id}/quotes`, {
        method: "POST",
        body: JSON.stringify({
          companyId,
          currency,
          transitDays: Number(transitDays),
          validityUntil: new Date(`${validityUntil}T23:59:59.000Z`).toISOString(),
          pricingSource,
          priceConfidence,
          notes: notes || undefined,
          terms: terms || undefined,
          serviceDetails: serviceDetails || undefined,
          routeDetails: routeDetails || undefined,
          unknownCharges: unknownCharges ? unknownCharges.split(",").map((item) => item.trim()).filter(Boolean) : [],
          excludedServices: excludedServices ? excludedServices.split(",").map((item) => item.trim()).filter(Boolean) : [],
          items: validItems
        })
      });
      setSuccess("تم إرسال العرض. سيظهر للعميل للمقارنة.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال العرض.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Skeleton className="h-64" />;
  if (error && !rfq) return <p className="text-error">{error}</p>;
  if (!rfq) return <EmptyState title="غير موجود" description="تعذر العثور على الطلب أو لا تملك صلاحية الوصول إليه." />;

  const myIds = new Set(companies.map((c) => c.id));
  const myQuotes = (rfq.quotes ?? []).filter((q: any) => myIds.has(q.companyId));
  const hasSubmittedQuote = myQuotes.some(
    (q: any) => q.status === "submitted" && new Date(q.validityUntil).getTime() > Date.now()
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">
          {rfq.origin} → {rfq.destination}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {rfq.mode} · {rfq.cargoDescription} · <span className="ltr-text">{String(rfq.weightKg)}</span> kg · الحالة: {rfq.status}
        </p>
      </div>

      {success ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-success" role="status">
          {success}
        </p>
      ) : null}

      {error && rfq ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-error">{error}</p>
      ) : null}

      <Card>
        <CardHeader title="بيانات الطلب المشتركة" subtitle="لا تعرض هذه الصفحة هوية العميل أو مستنداته الخاصة أو عروض المنافسين." />
        <div className="grid gap-3 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><p className="text-xs text-slate-400">الخدمة المطلوبة</p><p>{rfq.requiredService ?? "غير محددة"}</p></div>
          <div><p className="text-xs text-slate-400">الحجم / الوزن</p><p>{rfq.volumeCbm ? `${rfq.volumeCbm} CBM · ` : ""}{String(rfq.weightKg)} kg</p></div>
          <div><p className="text-xs text-slate-400">الطرود / الحاويات</p><p>{rfq.packageCount ?? "—"} / {rfq.containerCount ?? "—"} {rfq.containerType ? `(${rfq.containerType})` : ""}</p></div>
          <div><p className="text-xs text-slate-400">الاستلام / التسليم المفضل</p><p>{rfq.preferredPickupDate ? String(rfq.preferredPickupDate).slice(0, 10) : "—"} → {rfq.preferredDeliveryDate ? String(rfq.preferredDeliveryDate).slice(0, 10) : "—"}</p></div>
          <div><p className="text-xs text-slate-400">آخر موعد للتسليم</p><p>{rfq.latestDeliveryDate ? String(rfq.latestDeliveryDate).slice(0, 10) : "غير محدد"}</p></div>
          <div><p className="text-xs text-slate-400">بضاعة خطرة</p><p>{rfq.isHazardous ? "نعم" : "لا"}</p></div>
          <div><p className="text-xs text-slate-400">متطلبات خاصة</p><p>{rfq.specialRequirements ?? "لا توجد"}</p></div>
          <div><p className="text-xs text-slate-400">شرط التسليم</p><p>{rfq.incoterm ?? "—"}</p></div>
          <div><p className="text-xs text-slate-400">وضع الوصول</p><p>{rfq.discoveryMode === "marketplace" ? "سوق مفتوح" : "خاص"}</p></div>
        </div>
        {(rfq.documents ?? []).length > 0 ? (
          <div className="border-t border-slate-100 p-5">
            <p className="text-sm font-semibold text-navy">المستندات المشتركة</p>
            <ul className="mt-2 space-y-1 text-sm">
              {(rfq.documents ?? []).map((document: any) => (
                <li key={document.id} className="text-slate-600">{document.filename} · {document.type}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {myQuotes.length > 0 && (
        <Card>
          <CardHeader title="عروضك المقدّمة" subtitle="يبقى سجل كل نسخة. اسحب العرض النشط ثم قدّم نسخة جديدة قبل قبول العميل." />
          <div className="space-y-3 p-5">
            {myQuotes.map((q: any) => (
              <div key={q.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="ltr-text font-semibold text-navy">
                      {String(q.totalAmount)} {q.currency} · {q.transitDays} يوم
                      {Number(q.revisionNumber ?? 1) > 1 ? ` · نسخة ${q.revisionNumber}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      صالح حتى: <span className="ltr-text">{String(q.validityUntil).slice(0, 10)}</span>
                      {" · "}المصدر: {PRICING_SOURCE_LABEL[q.pricingSource] ?? q.pricingSource ?? "غير محدد"}
                      {" · "}الثقة: {CONFIDENCE_LABEL[q.priceConfidence] ?? q.priceConfidence ?? "غير محددة"}
                    </p>
                    {q.hasUnknownCharges ? <p className="mt-1 text-xs text-amber-700">توجد رسوم غير معروفة لم تُحسب في الإجمالي.</p> : null}
                    {q.rejectionReason ? <p className="mt-1 text-xs text-slate-500">{q.rejectionReason}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        q.status === "accepted"
                          ? "success"
                          : q.status === "withdrawn"
                            ? "neutral"
                            : q.status === "rejected"
                              ? "error"
                              : "info"
                      }
                    >
                      {QUOTE_STATUS_LABEL[q.status] ?? q.status}
                    </Badge>
                    {q.status === "submitted" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={withdrawing === q.id}
                        onClick={() => void withdraw(q.id)}
                      >
                        سحب العرض
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rfq.status === "cancelled" ? (
        <EmptyState
          title="تم إلغاء الطلب"
          description={rfq.cancellationReason ? `سبب الإلغاء: ${rfq.cancellationReason}` : "ألغى العميل طلب العرض."}
        />
      ) : rfq.status === "accepted" ? (
        <EmptyState title="تم قبول عرض" description="أُغلق هذا الطلب بعد اختيار العميل لعرض مقدَّم." />
      ) : hasSubmittedQuote ? (
        <EmptyState
          title="عرضك قيد المراجعة"
          description="تم إرسال عرض واحد لهذه الشركة. استخدم زر السحب أعلاه إذا أردت الانسحاب قبل قرار العميل."
        />
      ) : companies.length === 0 ? (
        <EmptyState
          title="لا توجد شركة مسجّلة"
          description="سجّل ملف شركتك أولاً لتقديم العروض."
        />
      ) : (
        <Card>
          <CardHeader
            title="تقديم عرض سعر"
            subtitle="الإجمالي يحسب البنود المضمنة غير الاختيارية فقط. الرسوم المستبعدة أو الاختيارية أو التقديرية أو غير المعروفة لا تُضاف بصمت."
          />
          <form onSubmit={submit} className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-slate-600">بصفة شركة</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-sm">
                <span className="block font-medium text-slate-600">العملة</span>
                <select
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <Input
                label="مدة العبور (أيام)"
                type="number"
                min={1}
                value={transitDays}
                onChange={(e) => setTransitDays(Number(e.target.value))}
                required
              />
              <Input
                label="صالح حتى"
                type="date"
                value={validityUntil}
                onChange={(e) => setValidityUntil(e.target.value)}
                required
              />
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-slate-600">مصدر التسعير</span>
                <select
                  aria-label="مصدر التسعير"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={pricingSource}
                  onChange={(e) => setPricingSource(e.target.value)}
                >
                  {PRICING_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>{source.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-slate-600">درجة الثقة</span>
                <select
                  aria-label="درجة الثقة"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={priceConfidence}
                  onChange={(e) => setPriceConfidence(e.target.value)}
                >
                  {CONFIDENCE_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
              </label>
              <Input label="تفاصيل الخدمة" value={serviceDetails} onChange={(e) => setServiceDetails(e.target.value)} />
              <Input label="تفاصيل المسار" value={routeDetails} onChange={(e) => setRouteDetails(e.target.value)} />
              <Input label="رسوم غير معروفة (مفصولة بفواصل)" value={unknownCharges} onChange={(e) => setUnknownCharges(e.target.value)} placeholder="مثال: رسم وزن في الميناء" />
              <Input label="خدمات مستبعدة (مفصولة بفواصل)" value={excludedServices} onChange={(e) => setExcludedServices(e.target.value)} placeholder="مثال: التخليص الجمركي" />
              <div className="md:col-span-2">
                <label className="block space-y-1 text-sm">
                  <span className="block font-medium text-slate-600">ملاحظات العرض</span>
                  <textarea aria-label="ملاحظات العرض" className="min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="block space-y-1 text-sm">
                  <span className="block font-medium text-slate-600">الشروط</span>
                  <textarea aria-label="شروط العرض" className="min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2" value={terms} onChange={(e) => setTerms(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">بنود السعر</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        label: "", amount: 0, currency, included: true, optional: false,
                        chargeType: "other", pricingSource: "provider_submitted",
                        priceConfidence: "indicative", sourceReference: "", notes: ""
                      }
                    ])
                  }
                >
                  + بند
                </Button>
              </div>

              <div className="space-y-3 p-4">
                {items.map((item, index) => (
                  <div key={index} className="grid gap-2 rounded-lg border border-slate-100 p-2 md:grid-cols-2 lg:grid-cols-4">
                    <Input
                      aria-label="وصف البند"
                      placeholder="وصف البند (مثال: أجرة الشحن)"
                      value={item.label}
                      onChange={(e) => updateItem(index, { label: e.target.value })}
                    />
                    <Input
                      aria-label="القيمة"
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => updateItem(index, { amount: Number(e.target.value) })}
                    />
                    <label className="space-y-1 text-xs text-slate-600">
                      <span>نوع الرسم</span>
                      <select
                        aria-label="نوع الرسم"
                        className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                        value={item.chargeType}
                        onChange={(e) => updateItem(index, { chargeType: e.target.value })}
                      >
                        {CHARGE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs text-slate-600">
                      <span>مصدر البند</span>
                      <select
                        aria-label="مصدر البند"
                        className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
                        value={item.pricingSource}
                        onChange={(e) => updateItem(index, { pricingSource: e.target.value })}
                      >
                        {PRICING_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
                      </select>
                    </label>
                    <Input label="مرجع المصدر" value={item.sourceReference} onChange={(e) => updateItem(index, { sourceReference: e.target.value })} />
                    <Input label="ملاحظات البند" value={item.notes} onChange={(e) => updateItem(index, { notes: e.target.value })} />
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={item.included} onChange={(e) => updateItem(index, { included: e.target.checked })} />
                        مُضمَّن
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={item.optional} onChange={(e) => updateItem(index, { optional: e.target.checked })} />
                        اختياري
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                      disabled={items.length === 1}
                    >
                      حذف
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
                <span className="text-slate-500">الإجمالي (البنود المُضمَّنة فقط)</span>
                <span className="ltr-text font-bold text-navy">
                  {total.toLocaleString("en-US", { minimumFractionDigits: 2 })} {currency}
                </span>
              </div>
            </div>

            {error && <p className="text-sm text-error">{error}</p>}

            <Button type="submit" isLoading={submitting}>
              إرسال العرض
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

type LineItem = { label: string; amount: number; currency: string; included: boolean };

const CURRENCIES = ["USD", "EUR", "EGP"];

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
  const [success, setSuccess] = useState("");

  const [companyId, setCompanyId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [transitDays, setTransitDays] = useState(14);
  const [validityUntil, setValidityUntil] = useState(defaultValidity());
  const [items, setItems] = useState<LineItem[]>([
    { label: "أجرة الشحن", amount: 0, currency: "USD", included: true },
    { label: "رسوم الميناء", amount: 0, currency: "USD", included: true }
  ]);

  const total = useMemo(
    () => items.filter((i) => i.included).reduce((sum, i) => sum + (Number(i.amount) || 0), 0),
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!companyId) {
      setError("اختر الشركة التي تقدّم العرض.");
      return;
    }
    const validItems = items
      .filter((i) => i.label.trim() && Number(i.amount) > 0)
      .map((i) => ({ label: i.label.trim(), amount: Number(i.amount), currency, included: i.included }));
    if (validItems.length === 0) {
      setError("أضف بندًا واحدًا على الأقل بقيمة أكبر من صفر.");
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

      {myQuotes.length > 0 && (
        <Card>
          <CardHeader title="عروضك المقدّمة" subtitle="لا يمكن تعديل عرض بعد إرساله في هذه النسخة." />
          <div className="space-y-3 p-5">
            {myQuotes.map((q: any) => (
              <div key={q.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="ltr-text font-semibold text-navy">
                      {String(q.totalAmount)} {q.currency} · {q.transitDays} يوم
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      صالح حتى: <span className="ltr-text">{String(q.validityUntil).slice(0, 10)}</span>
                    </p>
                  </div>
                  <Badge variant={q.status === "accepted" ? "success" : "info"}>{q.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {rfq.status === "accepted" ? (
        <EmptyState title="تم قبول عرض" description="أُغلق هذا الطلب بعد اختيار العميل لعرض مقدَّم." />
      ) : companies.length === 0 ? (
        <EmptyState
          title="لا توجد شركة مسجّلة"
          description="سجّل ملف شركتك أولاً لتقديم العروض."
        />
      ) : (
        <Card>
          <CardHeader title="تقديم عرض سعر" subtitle="الإجمالي يُحسب من البنود المُضمَّنة فقط. لا تُحتسب البنود المستثناة." />
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
            </div>

            <div className="rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700">بنود السعر</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setItems((prev) => [...prev, { label: "", amount: 0, currency, included: true }])}
                >
                  + بند
                </Button>
              </div>

              <div className="space-y-3 p-4">
                {items.map((item, index) => (
                  <div key={index} className="grid gap-2 md:grid-cols-[1fr_140px_auto_auto]">
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
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={item.included}
                        onChange={(e) => updateItem(index, { included: e.target.checked })}
                      />
                      مُضمَّن
                    </label>
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
            {success && <p className="text-sm text-success">{success}</p>}

            <Button type="submit" isLoading={submitting}>
              إرسال العرض
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}

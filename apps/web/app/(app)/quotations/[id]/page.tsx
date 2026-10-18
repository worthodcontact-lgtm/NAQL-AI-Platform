"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

export default function QuotationDetailsPage() {
  const params = useParams<{ id: string }>();
  const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offerForm, setOfferForm] = useState({ providerId: "", currency: "USD", amount: 1000, transitDays: 10, validityUntil: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
  const [actionLoading, setActionLoading] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await apiFetch(`/api/v1/quotations/${params.id}`);
      setQuote(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [params.id]);

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await apiFetch(`/api/v1/quotations/${params.id}/offers`, { method: "POST", body: JSON.stringify({ ...offerForm, validityUntil: new Date(offerForm.validityUntil).toISOString() }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setActionLoading(false);
    }
  }

  async function award(offerId: string) {
    if (!confirm("تأكيد منح هذا العرض؟")) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/v1/quotations/${params.id}/award`, { method: "POST", body: JSON.stringify({ offerId }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <p className="text-error">{error}</p>;
  if (!quote) return <EmptyState title="غير موجود" description="تعذر العثور على العرض." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">تفاصيل العرض</h1>
        <p className="text-sm text-slate-500">الشحنة: {quote.shipmentId} · الحالة: {quote.status}</p>
      </div>

      <Card>
        <CardHeader title="إضافة عرض من مزود" />
        <form onSubmit={addOffer} className="grid gap-3 p-5 md:grid-cols-5">
          <Input label="المزود" value={offerForm.providerId} onChange={(e) => setOfferForm({ ...offerForm, providerId: e.target.value })} required />
          <Input label="العملة" value={offerForm.currency} onChange={(e) => setOfferForm({ ...offerForm, currency: e.target.value })} required />
          <Input label="المبلغ" type="number" value={offerForm.amount} onChange={(e) => setOfferForm({ ...offerForm, amount: Number(e.target.value) })} required />
          <Input label="أيام العبور" type="number" value={offerForm.transitDays} onChange={(e) => setOfferForm({ ...offerForm, transitDays: Number(e.target.value) })} required />
          <Input label="صلاحية حتى" type="date" value={offerForm.validityUntil} onChange={(e) => setOfferForm({ ...offerForm, validityUntil: e.target.value })} required />
          <div className="md:col-span-5">
            <Button isLoading={actionLoading} type="submit">إضافة عرض</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="العروض" />
        <div className="p-5 space-y-3">
          {(quote.offers ?? []).length === 0 && <p className="text-sm text-slate-500">لا توجد عروض.</p>}
          {(quote.offers ?? []).map((o: any) => (
            <div key={o.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="font-semibold text-navy">{o.providerId}</p>
                <p className="text-sm text-slate-500">{o.amount} {o.currency} · {o.transitDays} days</p>
              </div>
              {quote.status !== "awarded" && <Button onClick={() => award(o.id)} disabled={actionLoading}>منح</Button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

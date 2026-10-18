"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

export default function RfqDetailsPage() {
  const params = useParams<{ id: string }>();
  const [rfq, setRfq] = useState<any>(null);
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      setRfq(await apiFetch(`/api/v1/rfqs/${params.id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function accept(quoteId: string) {
    if (!confirm("إنشاء طلب حجز بناءً على هذا العرض؟ الحجز لن يكون مؤكداً حتى تأكيد المزود.")) return;
    try {
      const res = await apiFetch(`/api/v1/rfqs/${params.id}/accept`, { method: "POST", body: JSON.stringify({ quoteId }) });
      setBooking(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  useEffect(() => { load(); }, [params.id]);

  if (loading) return <Skeleton className="h-64" />;
  if (error) return <p className="text-error">{error}</p>;
  if (!rfq) return <EmptyState title="غير موجود" description="تعذر العثور على الطلب." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">{rfq.origin} → {rfq.destination}</h1>
        <p className="text-sm text-slate-500">{rfq.mode} · {rfq.cargoDescription} · {rfq.weightKg} kg · الحالة: {rfq.status}</p>
      </div>

      {booking && (
        <Card>
          <CardHeader title="طلب الحجز" subtitle="الحالة تبقى requested حتى تأكيد المزود." />
          <div className="p-5 text-sm">
            رقم الحجز: <span className="ltr-text font-mono">{booking.id}</span> · الحالة: {booking.status}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="العروض الواردة" />
        <div className="space-y-3 p-5">
          {(rfq.quotes ?? []).length === 0 && <p className="text-sm text-slate-500">لا توجد عروض بعد.</p>}
          {(rfq.quotes ?? []).map((q: any) => (
            <div key={q.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-navy">{q.companyId}</p>
                  <p className="text-sm text-slate-500">{q.totalAmount} {q.currency} · {q.transitDays} days · {q.status}</p>
                </div>
                {rfq.status !== "accepted" && <Button onClick={() => accept(q.id)}>اختيار</Button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

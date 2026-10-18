"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/EmptyState";
import Link from "next/link";

export default function QuotationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [shipmentId, setShipmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [qRes, sRes] = await Promise.all([apiFetch("/api/v1/quotations"), apiFetch("/api/v1/shipments")]);
      setItems(qRes.items ?? []);
      setShipments(sRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!shipmentId) return;
    await apiFetch("/api/v1/quotations", { method: "POST", body: JSON.stringify({ shipmentId }) });
    setShipmentId("");
    await load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">العروض والتمهيدات</h1>
          <p className="text-sm text-slate-500">إدارة طلبات عروض الأسعار وربطها بالشحنات.</p>
        </div>
      </div>

      <Card>
        <CardHeader title="طلب عرض سعر" subtitle="أنشئ طلب عرض سعر لشحنة مملوكة لمؤسستك." />
        <div className="p-5 flex flex-col gap-3 sm:flex-row">
          <select className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
            <option value="">اختر شحنة</option>
            {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
          </select>
          <Button onClick={create} disabled={!shipmentId}>إنشاء طلب عرض</Button>
        </div>
      </Card>

      {loading && <Skeleton className="h-32" />}
      {error && <p className="text-error">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState title="لا توجد عروض" description="أنشئ طلب عرض سعر من شحنة مملوكة." />}
      <div className="space-y-3">
        {items.map((q) => (
          <Card key={q.id}>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-mono font-semibold text-navy">{q.id}</h3>
                  <p className="text-sm text-slate-500">الشحنة: {q.shipmentId} · الحالة: {q.status}</p>
                </div>
                <Link href={`/quotations/${q.id}`} className="text-primary text-sm font-semibold">التفاصيل</Link>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

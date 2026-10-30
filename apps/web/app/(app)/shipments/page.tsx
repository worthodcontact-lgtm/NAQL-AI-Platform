"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTATION_REQUESTED: "بانتظار العروض",
  QUOTED: "تم التسعير",
  BOOKED: "محجوز",
  IN_TRANSIT: "في الطريق",
  ARRIVED: "وصل",
  CUSTOMS_CLEARANCE: "تخليص جمركي",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
  EXCEPTION: "استثناء"
};

export default function ShipmentsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    originPortId: "",
    destinationPortId: "",
    mode: "SEA",
    incoterm: "FOB",
    cargoDescription: "",
    weightKg: 1000
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const json = await apiFetch("/api/v1/shipments");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الشحنات");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/api/v1/shipments", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setForm({ ...form, cargoDescription: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء الشحنة");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">الشحنات</h1>
        <p className="mt-2 text-sm text-slate-600">
          الشحنات التي تملكها شركتك أو تشارك فيها كطرف مدعو. كل شحنة لها صلاحياتها المستقلة.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <Card>
        <CardHeader title="شحنة جديدة" subtitle="تُنشأ الشحنة باسم مساحة العمل الحالية" />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <Input
            placeholder="كود ميناء المنشأ (مثال: ALY)"
            value={form.originPortId}
            onChange={(event) => setForm({ ...form, originPortId: event.target.value.toUpperCase() })}
          />
          <Input
            placeholder="كود ميناء المقصد (مثال: JED)"
            value={form.destinationPortId}
            onChange={(event) => setForm({ ...form, destinationPortId: event.target.value.toUpperCase() })}
          />
          <Input
            placeholder="وصف البضاعة"
            value={form.cargoDescription}
            onChange={(event) => setForm({ ...form, cargoDescription: event.target.value })}
          />
          <div className="flex items-end">
            <Button
              onClick={() => void create()}
              disabled={loading || !form.originPortId || !form.destinationPortId || form.cargoDescription.length < 3}
            >
              إنشاء الشحنة
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="قائمة الشحنات" subtitle={`${items.length} شحنة متاحة`} />
        <div className="space-y-3 p-5">
          {loading ? <Skeleton className="h-24 w-full" /> : null}
          {!loading && items.length === 0 ? (
            <EmptyState title="لا توجد شحنات" description="أنشئ شحنة جديدة أو انتظر دعوة من شركة أخرى." />
          ) : null}
          {items.map((shipment) => (
            <Link
              key={shipment.id}
              href={`/shipments/${shipment.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-primary/40 hover:bg-canvas"
            >
              <div>
                <p className="font-mono text-sm font-semibold text-navy">{shipment.reference}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {shipment.originPort?.name ?? shipment.originPortId} ← {shipment.destinationPort?.name ?? shipment.destinationPortId}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {shipment.viewerRole === "party" ? (
                  <Badge variant="info">طرف مشارك</Badge>
                ) : (
                  <Badge variant="success">شحنتك</Badge>
                )}
                <Badge variant="neutral">{STATUS_LABEL[shipment.status] ?? shipment.status}</Badge>
                <span className="text-xs text-slate-500">{shipment.mode} · {shipment.incoterm}</span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

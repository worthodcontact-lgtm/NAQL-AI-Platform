"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

export default function RfqPage() {
  const [items, setItems] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [form, setForm] = useState({ origin: "", destination: "", mode: "SEA", cargoDescription: "", weightKg: 1000 });
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [rfqRes, dirRes] = await Promise.all([apiFetch("/api/v1/rfqs"), apiFetch("/api/v1/companies/directory")]);
      setItems(rfqRes.items ?? []);
      setCompanies(dirRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/v1/rfqs", {
        method: "POST",
        body: JSON.stringify({ ...form, recipientCompanyIds: recipient ? [recipient] : [] })
      });
      setForm({ origin: "", destination: "", mode: "SEA", cargoDescription: "", weightKg: 1000 });
      setRecipient("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">طلبات العروض (RFQ)</h1>

      <Card>
        <CardHeader title="طلب عرض جديد" subtitle="سيتم إرساله للشركات المختارة داخل الدليل." />
        <form onSubmit={create} className="grid gap-3 p-5 md:grid-cols-3">
          <Input label="من" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} required />
          <Input label="إلى" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} required />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">الوسيلة</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              {["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <Input label="وصف البضاعة" value={form.cargoDescription} onChange={(e) => setForm({ ...form, cargoDescription: e.target.value })} required />
          <Input label="الوزن (kg)" type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} required />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">شركة (اختياري)</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">بدون تحديد</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="md:col-span-3"><Button type="submit">إنشاء RFQ</Button></div>
        </form>
        {error && <p className="px-5 pb-5 text-error">{error}</p>}
      </Card>

      {loading && <Skeleton className="h-40" />}
      {!loading && items.length === 0 && <EmptyState title="لا توجد طلبات" description="أنشئ أول طلب عرض." />}
      <div className="space-y-3">
        {items.map((r) => (
          <Card key={r.id}>
            <div className="flex items-center justify-between p-5">
              <div>
                <h3 className="font-semibold text-navy">{r.origin} → {r.destination}</h3>
                <p className="text-sm text-slate-500">{r.mode} · {r.weightKg} kg · {r.status}</p>
              </div>
              <Link href={`/rfqs/${r.id}`} className="text-sm font-semibold text-primary">التفاصيل</Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

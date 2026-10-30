"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  submitted: "مفتوح للعروض",
  accepted: "تم اختيار عرض",
  cancelled: "ملغي",
  rejected: "مرفوض"
};

export default function RfqPage() {
  const [items, setItems] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [ports, setPorts] = useState<any[]>([]);
  const [form, setForm] = useState({
    originPortId: "",
    destinationPortId: "",
    mode: "SEA",
    incoterm: "FOB",
    cargoDescription: "",
    weightKg: 1000,
    volumeCbm: "",
    packageCount: "",
    containerCount: "",
    containerType: "",
    requiredService: "",
    preferredPickupDate: "",
    preferredDeliveryDate: "",
    latestDeliveryDate: "",
    cargoValue: "",
    cargoCurrency: "USD",
    isHazardous: false,
    specialRequirements: "",
    discoveryMode: "invited"
  });
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [rfqRes, dirRes, portsRes] = await Promise.all([
        apiFetch("/api/v1/rfqs"),
        apiFetch("/api/v1/companies/directory"),
        apiFetch("/api/v1/ports")
      ]);
      setItems(rfqRes.items ?? []);
      setCompanies(dirRes.items ?? []);
      setPorts(portsRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function save(e: React.FormEvent | null, status: "draft" | "submitted") {
    e?.preventDefault();
    setError("");
    try {
      const origin = ports.find((port) => port.id === form.originPortId);
      const destination = ports.find((port) => port.id === form.destinationPortId);
      if (!origin || !destination) {
        setError("اختر ميناء أو مطاراً من دليل المواقع المتاح.");
        return;
      }
      const optionalNumber = (value: string) => (value.trim() ? Number(value) : undefined);
      const optionalDate = (value: string) => (value ? new Date(value).toISOString() : undefined);
      await apiFetch("/api/v1/rfqs", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          origin: origin.name,
          destination: destination.name,
          status,
          volumeCbm: optionalNumber(form.volumeCbm),
          packageCount: optionalNumber(form.packageCount),
          containerCount: optionalNumber(form.containerCount),
          containerType: form.containerType || undefined,
          requiredService: form.requiredService || undefined,
          preferredPickupDate: optionalDate(form.preferredPickupDate),
          preferredDeliveryDate: optionalDate(form.preferredDeliveryDate),
          latestDeliveryDate: optionalDate(form.latestDeliveryDate),
          cargoValue: optionalNumber(form.cargoValue),
          cargoCurrency: form.cargoValue ? form.cargoCurrency : undefined,
          specialRequirements: form.specialRequirements || undefined,
          recipientCompanyIds: recipient ? [recipient] : []
        })
      });
      setForm({
        originPortId: "",
        destinationPortId: "",
        mode: "SEA",
        incoterm: "FOB",
        cargoDescription: "",
        weightKg: 1000,
        volumeCbm: "",
        packageCount: "",
        containerCount: "",
        containerType: "",
        requiredService: "",
        preferredPickupDate: "",
        preferredDeliveryDate: "",
        latestDeliveryDate: "",
        cargoValue: "",
        cargoCurrency: "USD",
        isHazardous: false,
        specialRequirements: "",
        discoveryMode: "invited"
      });
      setRecipient("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  function create(e: React.FormEvent) {
    return save(e, "submitted");
  }

  useEffect(() => { load(); }, []);
  const compatiblePorts = ports.filter((port) =>
    form.mode === "SEA" ? port.type === "seaport" :
    form.mode === "AIR" ? port.type === "airport" : true
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">طلبات العروض (RFQ)</h1>

      <Card>
        <CardHeader title="طلب عرض جديد" subtitle="سيتم إرساله للشركات المختارة داخل الدليل." />
        <form onSubmit={create} className="grid gap-3 p-5 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">من</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.originPortId} onChange={(e) => setForm({ ...form, originPortId: e.target.value })} required>
              <option value="">اختر موقع الانطلاق</option>
              {compatiblePorts.map((port) => <option key={port.id} value={port.id}>{port.name} ({port.code})</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">إلى</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.destinationPortId} onChange={(e) => setForm({ ...form, destinationPortId: e.target.value })} required>
              <option value="">اختر موقع الوصول</option>
              {compatiblePorts.map((port) => <option key={port.id} value={port.id}>{port.name} ({port.code})</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">الوسيلة</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value, originPortId: "", destinationPortId: "" })}>
              {["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <Input label="وصف البضاعة" value={form.cargoDescription} onChange={(e) => setForm({ ...form, cargoDescription: e.target.value })} required />
          <Input label="الوزن (kg)" type="number" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: Number(e.target.value) })} required />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">شرط التسليم</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.incoterm} onChange={(e) => setForm({ ...form, incoterm: e.target.value })}>
              {["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"].map((term) => <option key={term}>{term}</option>)}
            </select>
          </label>
          <Input label="الحجم التقريبي (CBM)" type="number" value={form.volumeCbm} onChange={(e) => setForm({ ...form, volumeCbm: e.target.value })} />
          <Input label="عدد الطرود" type="number" value={form.packageCount} onChange={(e) => setForm({ ...form, packageCount: e.target.value })} />
          <Input label="عدد الحاويات" type="number" value={form.containerCount} onChange={(e) => setForm({ ...form, containerCount: e.target.value })} />
          <Input label="نوع الحاوية" value={form.containerType} onChange={(e) => setForm({ ...form, containerType: e.target.value })} placeholder="20GP / 40HC" />
          <Input label="الخدمة المطلوبة" value={form.requiredService} onChange={(e) => setForm({ ...form, requiredService: e.target.value })} placeholder="Ocean freight, customs clearance..." />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">أقصى موعد للاستلام</span>
            <input aria-label="أقصى موعد للاستلام" type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.preferredPickupDate} onChange={(e) => setForm({ ...form, preferredPickupDate: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">التسليم المفضل</span>
            <input aria-label="التسليم المفضل" type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.preferredDeliveryDate} onChange={(e) => setForm({ ...form, preferredDeliveryDate: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">آخر موعد للتسليم</span>
            <input aria-label="آخر موعد للتسليم" type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.latestDeliveryDate} onChange={(e) => setForm({ ...form, latestDeliveryDate: e.target.value })} />
          </label>
          <Input label="قيمة البضاعة (تقديرية)" type="number" value={form.cargoValue} onChange={(e) => setForm({ ...form, cargoValue: e.target.value })} />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">عملة قيمة البضاعة</span>
            <select aria-label="عملة قيمة البضاعة" className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.cargoCurrency} onChange={(e) => setForm({ ...form, cargoCurrency: e.target.value })}>
              {["USD", "EUR", "EGP"].map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isHazardous} onChange={(e) => setForm({ ...form, isHazardous: e.target.checked })} />
            <span className="font-medium text-slate-600">بضاعة خطرة</span>
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="block font-medium text-slate-600">طريقة الوصول للمزودين</span>
            <select aria-label="طريقة الوصول للمزودين" className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.discoveryMode} onChange={(e) => setForm({ ...form, discoveryMode: e.target.value })}>
              <option value="invited">خاص — الشركات المختارة فقط</option>
              <option value="marketplace">سوق مفتوح — مزودون مسجلون مؤهلون يمكنهم طلب الانضمام</option>
            </select>
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="block font-medium text-slate-600">شركة (اختياري)</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">بدون تحديد</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.nameAr || c.name}{c.isRegistered ? " · مسجلة" : ""}</option>)}
            </select>
          </label>
          <div className="md:col-span-3">
            <label className="mb-3 block space-y-1 text-sm">
              <span className="block font-medium text-slate-600">متطلبات خاصة</span>
              <textarea aria-label="متطلبات خاصة" className="min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2" value={form.specialRequirements} onChange={(e) => setForm({ ...form, specialRequirements: e.target.value })} />
            </label>
            <p className="mb-3 text-xs text-slate-500">
              في وضع السوق المفتوح تُعرض بيانات الطلب المحدودة للمزودين المسجلين المؤهلين فقط، دون هوية العميل أو مستنداته أو عروض المنافسين. الانضمام لا يمنح وصولاً إلى طلبات أخرى.
            </p>
            {ports.length === 0 && <p className="mb-3 text-sm text-amber-700">دليل الموانئ والمطارات غير متاح. اطلب من مسؤول المنصة تهيئة بيانات المواقع قبل إنشاء RFQ.</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={ports.length === 0}>إنشاء RFQ</Button>
              <Button type="button" variant="secondary" disabled={ports.length === 0} onClick={() => void save(null, "draft")}>حفظ كمسودة</Button>
            </div>
          </div>
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
                <p className="text-sm text-slate-500">
                  {r.mode} · {r.weightKg} kg · {STATUS_LABEL[r.status] ?? r.status}
                  {r.discoveryMode === "marketplace" ? " · سوق مفتوح" : ""}
                </p>
              </div>
              <Link href={`/rfqs/${r.id}`} className="text-sm font-semibold text-primary">التفاصيل</Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

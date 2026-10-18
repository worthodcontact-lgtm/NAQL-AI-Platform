"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";

export default function CompanyRegisterPage() {
  const [mine, setMine] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", type: "forwarder", country: "EG", description: "", website: "", email: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMine() {
    try {
      const res = await apiFetch("/api/v1/companies/mine");
      setMine(res.items ?? []);
    } catch { /* optional */ }
  }

  useEffect(() => { loadMine(); }, []);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await apiFetch("/api/v1/companies/register", { method: "POST", body: JSON.stringify({ ...form, website: form.website || undefined, email: form.email || undefined }) });
      await loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function submit(id: string) {
    await apiFetch(`/api/v1/companies/${id}/submit`, { method: "POST", body: JSON.stringify({}) });
    await loadMine();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">ملف الشركة</h1>

      <Card>
        <CardHeader title="تسجيل شركة" subtitle="إنشاء الحساب لا يعني التحقق. يجب إرسال الملف لمراجعة NAQL AI." />
        <form onSubmit={register} className="grid gap-3 p-5 md:grid-cols-2">
          <Input label="اسم الشركة" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">النوع</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {["forwarder", "carrier", "shipping", "air", "customs", "warehouse"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Input label="الدولة" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <Input label="الموقع الإلكتروني" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          <Input label="البريد الرسمي" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="md:col-span-2">
            <Textarea label="وصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="md:col-span-2"><Button isLoading={loading} type="submit">تسجيل الشركة</Button></div>
        </form>
        {error && <p className="px-5 pb-5 text-error">{error}</p>}
      </Card>

      <Card>
        <CardHeader title="شركاتي" />
        <div className="space-y-3 p-5">
          {mine.length === 0 && <EmptyState title="لا توجد شركات" description="سجّل شركتك للظهور في الدليل." />}
          {mine.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
              <div>
                <p className="font-semibold text-navy">{c.name}</p>
                <p className="text-sm text-slate-500">{c.type} · status: {c.status} · verification: {c.verificationStatus}</p>
              </div>
              {["draft", "needs_information"].includes(c.status) && <Button variant="secondary" onClick={() => submit(c.id)}>إرسال للمراجعة</Button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

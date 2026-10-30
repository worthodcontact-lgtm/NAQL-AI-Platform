"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function CostsPage() {
  const [form, setForm] = useState({ productCost: 1000, freight: 200, insurance: 30, customsDutyRate: 0.05, taxRate: 0.15, fees: 20, currency: "USD" });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const token = localStorage.getItem("token");
      const payload = Object.fromEntries(Object.entries(form).flatMap(([key, value]) => {
        if (key !== "currency" && String(value).trim() === "") return [];
        return [[key, key === "currency" ? value : Number(value)]];
      }));
      const res = await fetch(`${API}/api/v1/costs/landed-cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Request failed");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold text-emerald-800">حساب التكلفة Landed Cost</h1>
      <form onSubmit={submit} className="mt-4 grid gap-2 md:grid-cols-2">
        {Object.entries(form).map(([key, value]) => (
          <label key={key} className="text-sm">
            <span className="mb-1 block text-slate-600">{key}</span>
            <input className="w-full rounded border p-2" value={String(value)}
              onChange={(e) => setForm({ ...form, [key]: key === "currency" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value) })} />
          </label>
        ))}
        <button disabled={loading} className="rounded bg-emerald-700 px-4 py-2 text-white md:col-span-2">{loading ? "..." : "احسب"}</button>
      </form>
      {error && <p className="mt-3 text-red-600">{error}</p>}
      {result && <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm" dir="rtl">
        <p className="font-semibold text-amber-900">{result.status === "incomplete" ? "التكلفة غير مكتملة — توجد مكونات أو معدلات مجهولة" : "تقدير غير مؤكد — لم يتم التحقق من الأسعار أو الرسوم الجمركية"}</p>
        <p className="mt-1 text-amber-900">كل المبالغ والمدخلات الضريبية مقدمة من المستخدم. لا تُعامل المكونات المجهولة كصفر.</p>
        <p className="mt-2 font-semibold">الإجمالي: {result.total === null ? "غير متاح حتى استكمال المدخلات" : `${result.total} ${result.currency}`}</p>
        {result.unknownComponents?.length > 0 && <p className="mt-1 text-amber-900">مدخلات مطلوبة: {result.unknownComponents.join("، ")}</p>}
        <pre className="mt-3 overflow-auto rounded border bg-white p-3 text-left text-xs">{JSON.stringify(result, null, 2)}</pre>
      </section>}
    </main>
  );
}

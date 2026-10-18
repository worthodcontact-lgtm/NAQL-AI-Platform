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
      const res = await fetch(`${API}/api/v1/costs/landed-cost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(form)
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
              onChange={(e) => setForm({ ...form, [key]: key.includes("Rate") ? Number(e.target.value) : key === "currency" ? e.target.value : Number(e.target.value) || e.target.value })} />
          </label>
        ))}
        <button disabled={loading} className="rounded bg-emerald-700 px-4 py-2 text-white md:col-span-2">{loading ? "..." : "احسب"}</button>
      </form>
      {error && <p className="mt-3 text-red-600">{error}</p>}
      {result && <pre className="mt-4 rounded border bg-white p-3 text-sm">{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}

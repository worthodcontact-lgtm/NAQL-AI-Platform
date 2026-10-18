"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function ShipmentsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ originPortId: "", destinationPortId: "", mode: "SEA", incoterm: "FOB", cargoDescription: "", weightKg: 1000 });

  async function load() {
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/v1/shipments`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to load");
      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API}/api/v1/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Create failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold text-emerald-800">الشحنات</h1>
      {loading && <p className="text-slate-500">جار التحميل...</p>}
      {error && <p className="text-red-600">{error}</p>}
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <input className="rounded border p-2" placeholder="ميناء المنشأ" value={form.originPortId} onChange={e => setForm({ ...form, originPortId: e.target.value })} />
        <input className="rounded border p-2" placeholder="ميناء المقصد" value={form.destinationPortId} onChange={e => setForm({ ...form, destinationPortId: e.target.value })} />
        <input className="rounded border p-2" placeholder="الوصف" value={form.cargoDescription} onChange={e => setForm({ ...form, cargoDescription: e.target.value })} />
        <button onClick={create} className="rounded bg-emerald-700 px-4 py-2 text-white">إنشاء</button>
      </div>
      <ul className="mt-6 space-y-2">
        {items.map((s) => (
          <li key={s.id} className="rounded border bg-white p-3">
            <span className="font-mono">{s.reference}</span> — {s.status}
          </li>
        ))}
      </ul>
    </main>
  );
}

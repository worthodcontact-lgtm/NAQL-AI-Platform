"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PublicHeader from "@/components/layout/PublicHeader";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function DirectoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (type) params.set("type", type);
      const res = await fetch(`${API}/api/v1/companies/directory?${params}`);
      const json = await res.json();
      setItems(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-3xl font-bold text-navy">دليل الشركات اللوجستية</h1>
      <p className="mt-2 text-sm text-slate-500">الإدراج في الدليل لا يعني شهادة أو شراكة موثقة. يتم عرض حالة التحقق بوضوح.</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <input className="w-full rounded-lg border border-slate-200 px-3 py-2" placeholder="ابحث بالاسم أو الدولة" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded-lg border border-slate-200 px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">كل الأنواع</option>
          {["forwarder", "carrier", "shipping", "air", "customs", "warehouse"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={load} className="rounded-lg bg-primary px-5 py-2 text-white">بحث</button>
      </div>

      {loading ? <p className="mt-6 text-slate-500">جار التحميل...</p> : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.id} href={`/directory/${c.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="font-semibold text-navy">{c.name}</h2>
              <p className="text-sm text-slate-500">{c.type} · {c.country ?? "—"}</p>
              <p className={`mt-3 text-xs font-semibold ${c.verificationStatus === "verified" ? "text-success" : "text-warning"}`}>
                {c.verificationStatus === "verified" ? "موثقة" : c.verificationStatus === "pending" ? "قيد المراجعة" : "غير موثقة"}
              </p>
            </Link>
          ))}
          {!loading && items.length === 0 && <p className="text-slate-500">لا توجد شركات مطابقة.</p>}
        </div>
      )}
      </main>
    </>
  );
}

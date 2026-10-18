"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function DashboardPage() {
  const [health, setHealth] = useState<string>("checking...");
  const [shipments, setShipments] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/health`).then(r => r.json()).then(d => setHealth(JSON.stringify(d))).catch(() => setHealth("offline"));
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${API}/api/v1/shipments`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setShipments(Array.isArray(d.items) ? d.items : []))
        .catch(() => setShipments([]));
    }
  }, []);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-bold text-emerald-800">لوحة التحكم</h1>
      <p className="mt-1 text-sm text-slate-500">حالة API: {health}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">الشحنات</div>
          <div className="text-3xl font-bold">{shipments.length}</div>
        </div>
      </div>
    </main>
  );
}

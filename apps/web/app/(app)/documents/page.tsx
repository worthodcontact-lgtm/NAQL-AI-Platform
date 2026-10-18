"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DocumentsPage() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [shipmentId, setShipmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState("invoice");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [sRes, dRes] = await Promise.all([apiFetch("/api/v1/shipments"), apiFetch(`/api/v1/documents${shipmentId ? `?shipmentId=${shipmentId}` : ""}`)]);
      setShipments(sRes.items ?? []);
      setDocuments(dRes.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [shipmentId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !shipmentId) return;
    setUploading(true); setError("");
    try {
      const dataBase64 = await toBase64(file);
      await apiFetch(`/api/v1/shipments/${shipmentId}/documents`, {
        method: "POST",
        body: JSON.stringify({ type, filename: file.name, contentType: file.type || "application/octet-stream", size: file.size, dataBase64 })
      });
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setUploading(false);
    }
  }

  async function validate(id: string) {
    const res = await apiFetch(`/api/v1/documents/${id}/validate`, { method: "POST" });
    alert(JSON.stringify(res, null, 2));
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">مركز الوثائق</h1>
      <Card>
        <CardHeader title="رفع / تسجيل وثيقة" subtitle="الحد الأقصى 2MB. تخزين adapter قد يكون ذاكرة تطوير (dev fallback)." />
        <form onSubmit={upload} className="grid gap-3 p-5 md:grid-cols-4">
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} required>
            <option value="">اختر شحنة</option>
            {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
          </select>
          <Input label="النوع" value={type} onChange={(e) => setType(e.target.value)} />
          <input type="file" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          <div className="flex items-end">
            <Button isLoading={uploading} type="submit" disabled={!file || !shipmentId}>رفع</Button>
          </div>
        </form>
        {error && <p className="px-5 pb-5 text-error">{error}</p>}
      </Card>

      {loading && <Skeleton className="h-40" />}
      {!loading && documents.length === 0 && <EmptyState title="لا توجد وثائق" description="قم برفع أو تسجيل وثيقة مربوطة شحنة." />}
      <div className="space-y-3">
        {documents.map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between p-5">
              <div>
                <h3 className="font-semibold text-navy">{d.filename} <span className="text-xs text-slate-500">({d.type})</span></h3>
                <p className="text-sm text-slate-500">الحالة: {d.status} · {d.uploadedAt}</p>
                {d.validation && <p className="mt-1 text-xs text-slate-600 ltr-text">{d.validation}</p>}
              </div>
              <Button variant="secondary" onClick={() => validate(d.id)}>التحقق (AI)</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { useAuth } from "@/components/providers/AuthProvider";
import { isPlatformStaffRole } from "@/lib/auth";

export default function AdminPage() {
  const { user, ready } = useAuth();
  const allowed = Boolean(ready && user && isPlatformStaffRole(user.roles));
  const [overview, setOverview] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try {
      const [o, c, a] = await Promise.all([
        apiFetch("/api/v1/admin/overview"),
        apiFetch("/api/v1/admin/companies"),
        apiFetch("/api/v1/admin/audit")
      ]);
      setOverview(o); setCompanies(c.items ?? []); setAudit(a.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (allowed) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function review(id: string, decision: string) {
    try {
      await apiFetch(`/api/v1/admin/companies/${id}/verify`, { method: "POST", body: JSON.stringify({ decision }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  }

  if (!ready) return <Skeleton className="h-64" />;
  if (!allowed) return <EmptyState title="ممنوع" description="هذه الصفحة لموظفي مراجعة NAQL AI فقط." />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">إدارة NAQL AI</h1>
      {error && <p className="text-error">{error}</p>}
      {loading && <Skeleton className="h-40" />}

      {overview && (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Object.entries(overview).filter(([k]) => k !== "devFallback").map(([k, v]) => (
            <Card key={k} className="p-4">
              <p className="text-xs text-slate-500">{k}</p>
              <p className="text-2xl font-bold text-navy">{String(v)}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="مراجعة الشركات" subtitle="التحقق منفصل عن إدارة الشركة. كل إجراء يُسجل في سجل التدقيق." />
        <div className="space-y-3 p-5">
          {companies.length === 0 && <p className="text-sm text-slate-500">لا توجد شركات.</p>}
          {companies.map((c) => (
            <div key={c.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-navy">{c.name}</p>
                <p className="text-sm text-slate-500">{c.type} · status: {c.status} · verification: {c.verificationStatus}</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => review(c.id, "approved")}>موافقة</Button>
                <Button variant="secondary" onClick={() => review(c.id, "needs_information")}>طلب معلومات</Button>
                <Button variant="danger" onClick={() => review(c.id, "rejected")}>رفض</Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="سجل التدقيق" />
        <div className="space-y-2 p-5 text-sm">
          {audit.length === 0 && <p className="text-slate-500">لا توجد أحداث.</p>}
          {audit.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between border-b border-slate-100 py-2">
              <span className="font-mono text-xs ltr-text">{a.action}</span>
              <span className="text-slate-500">{a.entityType} · {a.createdAt}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

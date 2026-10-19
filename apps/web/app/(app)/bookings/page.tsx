"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

const STATUS_LABEL: Record<string, string> = {
  requested: "بانتظار قرار المزوّد",
  confirmed: "مؤكد",
  rejected: "مرفوض",
  cancelled: "ملغي"
};

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "neutral"> = {
  requested: "info",
  confirmed: "success",
  rejected: "error",
  cancelled: "neutral"
};

/**
 * Booking decisions and manual tracking.
 *
 * The viewer role is computed by the API from organization and company ownership.
 * Confirming is only possible for the provider that owns the accepted quote, and the
 * API enforces that independently of this screen.
 */
export default function BookingsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { reference: string; reason: string; code: string; label: string }>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/bookings");
      setItems(res.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الحجوزات.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function draft(id: string) {
    return drafts[id] ?? { reference: "", reason: "", code: "", label: "" };
  }

  function setDraft(id: string, patch: Partial<ReturnType<typeof draft>>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...draft(id), ...patch } }));
  }

  async function decide(id: string, action: "confirm" | "reject") {
    const d = draft(id);
    if (action === "confirm" && !d.reference.trim()) {
      setError("رقم المرجع مطلوب لتأكيد الحجز.");
      return;
    }
    setBusy(id);
    setError("");
    try {
      await apiFetch(`/api/v1/bookings/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(
          action === "confirm"
            ? { externalReference: d.reference.trim() }
            : { reason: d.reason.trim() || undefined }
        )
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تنفيذ الإجراء.");
    } finally {
      setBusy(null);
    }
  }

  async function addTracking(id: string) {
    const d = draft(id);
    if (!d.code.trim() || !d.label.trim()) {
      setError("كود ووصف الحدث مطلوبان.");
      return;
    }
    setBusy(id);
    setError("");
    try {
      await apiFetch(`/api/v1/bookings/${id}/tracking`, {
        method: "POST",
        body: JSON.stringify({ code: d.code.trim(), label: d.label.trim() })
      });
      setDraft(id, { code: "", label: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إضافة الحدث.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">الحجوزات</h1>
        <p className="mt-1 text-sm text-slate-500">
          الحجز لا يصبح مؤكداً إلا بقرار المزوّد صاحب العرض المقبول. أحداث التتبع المُدخلة يدوياً مُوسّمة بمصدرها.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {loading && <Skeleton className="h-40" />}
      {!loading && items.length === 0 && (
        <EmptyState title="لا توجد حجوزات" description="ستظهر الحجوزات بعد قبول عرض من طلبات العروض." />
      )}

      <div className="space-y-4">
        {items.map((b) => {
          const d = draft(b.id);
          const isProvider = b.viewerRole === "provider";
          const isOpen = b.status === "requested";
          const events = b.trackingEvents ?? [];

          return (
            <Card key={b.id}>
              <CardHeader
                title={b.rfq ? `${b.rfq.origin} → ${b.rfq.destination}` : `حجز ${String(b.id).slice(0, 8)}`}
                subtitle={`رقم الحجز: ${b.id}`}
                action={<Badge variant={STATUS_VARIANT[b.status] ?? "neutral"}>{STATUS_LABEL[b.status] ?? b.status}</Badge>}
              />

              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <Badge variant={isProvider ? "success" : "info"}>{isProvider ? "بصفة مزوّد" : "بصفة عميل"}</Badge>
                  {b.externalReference && (
                    <span>
                      مرجع المزوّد: <span className="ltr-text font-mono">{b.externalReference}</span>
                    </span>
                  )}
                </div>

                {isOpen && isProvider && (
                  <div className="grid gap-3 rounded-lg border border-slate-200 p-4 md:grid-cols-2">
                    <Input
                      label="رقم مرجع التأكيد (مطلوب)"
                      placeholder="مثال: BKG-2026-0001"
                      value={d.reference}
                      onChange={(e) => setDraft(b.id, { reference: e.target.value })}
                    />
                    <Input
                      label="سبب الرفض (اختياري)"
                      placeholder="مثال: لا توجد سعة متاحة"
                      value={d.reason}
                      onChange={(e) => setDraft(b.id, { reason: e.target.value })}
                    />
                    <div className="flex gap-3 md:col-span-2">
                      <Button isLoading={busy === b.id} onClick={() => decide(b.id, "confirm")}>
                        تأكيد الحجز
                      </Button>
                      <Button
                        variant="danger"
                        isLoading={busy === b.id}
                        onClick={() => decide(b.id, "reject")}
                      >
                        رفض الحجز
                      </Button>
                    </div>
                  </div>
                )}

                {isOpen && !isProvider && (
                  <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    طلب الحجز في انتظار قرار المزوّد صاحب العرض المقبول.
                  </p>
                )}

                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                    أحداث التتبع
                  </div>
                  <div className="p-4">
                    {events.length === 0 && <p className="text-sm text-slate-500">لا توجد أحداث مسجّلة بعد.</p>}
                    <ol className="space-y-3">
                      {events.map((ev: any) => (
                        <li key={ev.id} className="flex items-start justify-between gap-4 text-sm">
                          <div>
                            <p className="font-semibold text-slate-700">{ev.label}</p>
                            <p className="text-xs text-slate-500">
                              <span className="ltr-text">{ev.code}</span> · المصدر:{" "}
                              <span className="font-semibold">{ev.source ?? "غير معروف"}</span>
                            </p>
                          </div>
                          <span className="ltr-text whitespace-nowrap text-xs text-slate-400">
                            {String(ev.occurredAt ?? "").slice(0, 16).replace("T", " ")}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-[160px_1fr_auto]">
                    <Input
                      aria-label="كود الحدث"
                      placeholder="الكود"
                      value={d.code}
                      onChange={(e) => setDraft(b.id, { code: e.target.value })}
                    />
                    <Input
                      aria-label="وصف الحدث"
                      placeholder="وصف الحدث (مثال: غادر الميناء)"
                      value={d.label}
                      onChange={(e) => setDraft(b.id, { label: e.target.value })}
                    />
                    <Button variant="secondary" isLoading={busy === b.id} onClick={() => addTracking(b.id)}>
                      إضافة حدث
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

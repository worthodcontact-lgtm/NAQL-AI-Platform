"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة",
  QUOTATION_REQUESTED: "بانتظار العروض",
  QUOTED: "تم التسعير",
  BOOKED: "محجوز",
  IN_TRANSIT: "في الطريق",
  ARRIVED: "وصل",
  CUSTOMS_CLEARANCE: "تخليص جمركي",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
  EXCEPTION: "استثناء"
};

const EVENT_OPTIONS = [
  { code: "BOOKING_CONFIRMED", label: "تأكيد الحجز" },
  { code: "CARGO_RECEIVED", label: "استلام البضاعة" },
  { code: "DEPARTED", label: "مغادرة الميناء" },
  { code: "IN_TRANSIT", label: "في الطريق" },
  { code: "ARRIVED", label: "الوصول" },
  { code: "CUSTOMS_PROCESSING", label: "بدء التخليص الجمركي" },
  { code: "CARGO_RELEASED", label: "الإفراج عن البضاعة" },
  { code: "DELIVERED", label: "إتمام التسليم" },
  { code: "DELAYED", label: "تأخير" },
  { code: "CANCELLED", label: "إلغاء" }
];

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
  const [drafts, setDrafts] = useState<
    Record<string, { reference: string; reason: string; code: string; note: string; idempotencyKey: string }>
  >({});

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
    return drafts[id] ?? {
      reference: "",
      reason: "",
      code: "IN_TRANSIT",
      note: "",
      idempotencyKey: newIdempotencyKey()
    };
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
    if (action === "reject" && d.reason.trim().length < 3) {
      setError("سبب الرفض مطلوب (3 أحرف على الأقل) ويُحفظ في السجل.");
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
            : { reason: d.reason.trim() }
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
    if (!d.code) {
      setError("اختر نوع الحدث.");
      return;
    }
    const idempotencyKey = drafts[id]?.idempotencyKey ?? newIdempotencyKey();
    if (!drafts[id]) setDraft(id, { idempotencyKey });
    setBusy(id);
    setError("");
    try {
      await apiFetch(`/api/v1/bookings/${id}/tracking`, {
        method: "POST",
        body: JSON.stringify({
          code: d.code,
          note: d.note.trim() || undefined,
          source: "manual",
          idempotencyKey
        })
      });
      setDraft(id, { note: "", idempotencyKey: newIdempotencyKey() });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إضافة الحدث.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelBooking(id: string) {
    const reason = window.prompt("سبب إلغاء الحجز (مطلوب ويُحفظ في السجل):");
    if (!reason || reason.trim().length < 3) {
      setError("سبب الإلغاء مطلوب (3 أحرف على الأقل).");
      return;
    }
    setBusy(id);
    setError("");
    try {
      await apiFetch(`/api/v1/bookings/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إلغاء الحجز.");
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
                  {b.shipment?.id || b.shipmentId ? (
                    <Link
                      href={`/shipments/${b.shipment?.id ?? b.shipmentId}`}
                      className="font-semibold text-primary"
                    >
                      فتح الشحنة المرتبطة
                      {b.shipment?.status ? ` · ${SHIPMENT_STATUS_LABEL[b.shipment.status] ?? b.shipment.status}` : ""}
                    </Link>
                  ) : null}
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
                      label="سبب الرفض (مطلوب ويُحفظ في السجل)"
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

                {b.rejectionReason ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    سبب الرفض: {b.rejectionReason}
                    {b.decidedAt ? ` · ${String(b.decidedAt).slice(0, 16).replace("T", " ")}` : ""}
                  </p>
                ) : null}
                {b.cancellationReason ? (
                  <p className="rounded-lg border border-slate-200 bg-canvas px-4 py-3 text-sm text-slate-700">
                    سبب الإلغاء: {b.cancellationReason}
                    {b.cancelledAt ? ` · ${String(b.cancelledAt).slice(0, 16).replace("T", " ")}` : ""}
                  </p>
                ) : null}

                {(b.status === "requested" || b.status === "confirmed") ? (
                  <div>
                    <Button size="sm" variant="secondary" isLoading={busy === b.id} onClick={() => void cancelBooking(b.id)}>
                      إلغاء الحجز
                    </Button>
                  </div>
                ) : null}

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

                  <div className="grid gap-3 border-t border-slate-200 p-4 md:grid-cols-[200px_1fr_auto]">
                    <select
                      aria-label="نوع الحدث"
                      className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      value={d.code}
                      onChange={(e) => setDraft(b.id, { code: e.target.value })}
                    >
                      {EVENT_OPTIONS.map((event) => (
                        <option key={event.code} value={event.code}>{event.label}</option>
                      ))}
                    </select>
                    <Input
                      aria-label="ملاحظة الحدث"
                      placeholder="ملاحظة اختيارية عن الحدث"
                      value={d.note}
                      onChange={(e) => setDraft(b.id, { note: e.target.value })}
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

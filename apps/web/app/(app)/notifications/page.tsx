"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

const TYPE_LABEL: Record<string, string> = {
  RFQ_SUBMITTED: "طلب عرض جديد",
  RFQ_CANCELLED: "إلغاء طلب عرض",
  MARKETPLACE_JOINED: "انضمام مزود لطلب",
  QUOTATION_RECEIVED: "عرض سعر مستلم",
  QUOTATION_ACCEPTED: "قبول عرض",
  QUOTATION_REJECTED: "رفض عرض",
  QUOTATION_WITHDRAWN: "سحب عرض",
  BOOKING_CONFIRMED: "تأكيد حجز",
  BOOKING_REJECTED: "رفض حجز",
  BOOKING_CANCELLED: "إلغاء حجز",
  DOCUMENT_FINDINGS: "تعارض مستندات",
  SHIPMENT_MILESTONE: "مرحلة شحنة",
  RISK_ALERT: "تنبيه مخاطر",
  DOCUMENT_UPLOADED: "مستند مرفوع"
};

const SEVERITY_VARIANT: Record<string, "success" | "warning" | "error" | "info" | "neutral"> = {
  info: "info",
  warning: "warning",
  error: "error",
  critical: "error"
};

const DELIVERY_LABEL: Record<string, string> = {
  persisted: "محفوظ داخل التطبيق",
  queued: "بانتظار مزود خارجي",
  external_queued: "قيد الإرسال الخارجي",
  external_sent: "أُرسل خارجياً",
  external_failed: "فشل الإرسال الخارجي"
};

const EXTERNAL_STATUS_LABEL: Record<string, string> = {
  not_attempted: "لم تُجرَّب",
  queued: "في قائمة الانتظار",
  attempted: "جرت محاولة إرسال",
  sent: "أُرسل",
  failed: "فشل",
  provider_unavailable: "لا يوجد مزود خارجي"
};

function entityHref(item: any): string | null {
  if (!item.entityId) return null;
  if (item.entityType === "Shipment") return `/shipments/${item.entityId}`;
  if (item.entityType === "BookingRequest") return "/bookings";
  if (item.entityType === "Rfq") return `/rfqs/${item.entityId}`;
  if (item.entityType === "Quote") return "/bookings";
  return null;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [delivery, setDelivery] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/v1/notifications?page=${page}&limit=20${unreadOnly ? "&unreadOnly=true" : ""}`
      );
      setItems(res.items ?? []);
      setUnreadCount(res.unreadCount ?? 0);
      setHasMore(Boolean(res.hasMore));
      setDelivery(res.externalDelivery ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل التنبيهات.");
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function markRead(id: string) {
    setBusy(id);
    setError("");
    try {
      await apiFetch(`/api/v1/notifications/${id}/read`, { method: "PATCH" });
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item))
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحديث التنبيه.");
    } finally {
      setBusy("");
    }
  }

  async function markAll() {
    setBusy("all");
    setError("");
    try {
      const res = await apiFetch("/api/v1/notifications/read-all", { method: "POST" });
      setNotice(`تم تحديد ${res.updated ?? 0} تنبيه كمقروء.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحديث التنبيهات.");
    } finally {
      setBusy("");
    }
  }

  async function retryDelivery(id: string) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/notifications/${id}/retry-delivery`, { method: "POST" });
      setNotice("تمت محاولة الإرسال الخارجي. التنبيه داخل التطبيق يبقى محفوظاً دائماً.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال التنبيه خارجياً.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">التنبيهات</h1>
          <p className="mt-1 text-sm text-slate-500">
            تنبيهات محفوظة داخل مساحة عملك. لا يعني حفظ التنبيه أنه أُرسل بالبريد أو واتساب.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={unreadCount > 0 ? "warning" : "neutral"}>{unreadCount} غير مقروء</Badge>
          <Button
            variant="secondary"
            size="sm"
            isLoading={busy === "all"}
            disabled={unreadCount === 0}
            onClick={() => void markAll()}
          >
            تحديد الكل كمقروء
          </Button>
        </div>
      </div>

      {delivery ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          القناة الخارجية: {delivery.provider === "none" ? "غير مهيأة" : delivery.provider} ·{" "}
          {delivery.configured ? "المزود مهيأ" : "لا يوجد مزود بريد أو واتساب مهيأ، لذلك لا يوجد إرسال خارجي."}
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm text-teal-dark">{notice}</div> : null}

      <Card>
        <CardHeader
          title="صندوق التنبيهات"
          subtitle="أحدث التنبيهات أولاً"
          action={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => {
                  setPage(1);
                  setUnreadOnly(event.target.checked);
                }}
              />
              غير المقروء فقط
            </label>
          }
        />
        <div className="space-y-3 p-5">
          {loading ? <Skeleton className="h-32" /> : null}
          {!loading && items.length === 0 ? (
            <EmptyState title="لا توجد تنبيهات" description="ستظهر هنا تنبيهات العروض والحجوزات والشحنات والمستندات." />
          ) : null}
          {items.map((item) => {
            const href = entityHref(item);
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 ${item.read ? "border-slate-200 bg-white" : "border-teal/40 bg-teal/5"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={SEVERITY_VARIANT[item.severity] ?? "neutral"}>
                        {TYPE_LABEL[item.type] ?? item.type}
                      </Badge>
                      {!item.read ? <Badge variant="info">جديد</Badge> : null}
                      <span className="ltr-text text-xs text-slate-400">
                        {String(item.createdAt ?? "").slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold text-navy">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{item.body}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {DELIVERY_LABEL[item.deliveryStatus] ?? item.deliveryStatus} ·{" "}
                      {EXTERNAL_STATUS_LABEL[item.externalDeliveryStatus] ?? item.externalDeliveryStatus}
                      {item.externalDeliveryAttempts > 0
                        ? ` · المحاولات: ${item.externalDeliveryAttempts}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {href ? (
                      <Link href={href} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-primary">
                        فتح
                      </Link>
                    ) : null}
                    {!item.read ? (
                      <Button size="sm" variant="ghost" isLoading={busy === item.id} onClick={() => void markRead(item.id)}>
                        مقروء
                      </Button>
                    ) : null}
                    {delivery?.configured ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={busy === item.id}
                        onClick={() => void retryDelivery(item.id)}
                      >
                        إعادة الإرسال الخارجي
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
            السابق
          </Button>
          <span className="text-xs text-slate-500">صفحة {page}</span>
          <Button size="sm" variant="secondary" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>
            التالي
          </Button>
        </div>
      </Card>
    </div>
  );
}

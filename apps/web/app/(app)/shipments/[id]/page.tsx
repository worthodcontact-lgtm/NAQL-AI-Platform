"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";

const STATUS_LABEL: Record<string, string> = {
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

const NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ["QUOTATION_REQUESTED", "CANCELLED"],
  QUOTATION_REQUESTED: ["QUOTED", "CANCELLED"],
  QUOTED: ["BOOKED", "CANCELLED"],
  BOOKED: ["IN_TRANSIT", "EXCEPTION", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED", "EXCEPTION", "CANCELLED"],
  ARRIVED: ["CUSTOMS_CLEARANCE", "EXCEPTION", "CANCELLED"],
  CUSTOMS_CLEARANCE: ["DELIVERED", "EXCEPTION", "CANCELLED"],
  EXCEPTION: ["IN_TRANSIT", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: []
};

const EVENT_OPTIONS = [
  { code: "BOOKING_CONFIRMED", label: "تأكيد الحجز", from: ["DRAFT", "QUOTATION_REQUESTED", "QUOTED", "BOOKED"] },
  { code: "CARGO_RECEIVED", label: "استلام البضاعة", from: ["BOOKED", "IN_TRANSIT"] },
  { code: "DEPARTED", label: "مغادرة الميناء", from: ["BOOKED"] },
  { code: "IN_TRANSIT", label: "في الطريق", from: ["BOOKED", "IN_TRANSIT", "EXCEPTION"] },
  { code: "ARRIVED", label: "الوصول", from: ["IN_TRANSIT", "EXCEPTION"] },
  { code: "CUSTOMS_PROCESSING", label: "بدء التخليص الجمركي", from: ["ARRIVED", "CUSTOMS_CLEARANCE"] },
  { code: "CARGO_RELEASED", label: "الإفراج عن البضاعة", from: ["CUSTOMS_CLEARANCE"] },
  { code: "DELIVERED", label: "إتمام التسليم", from: ["ARRIVED", "CUSTOMS_CLEARANCE", "DELIVERED"] },
  { code: "DELAYED", label: "تأخير", from: ["BOOKED", "IN_TRANSIT", "ARRIVED", "CUSTOMS_CLEARANCE", "EXCEPTION"] },
  { code: "CANCELLED", label: "إلغاء الشحنة", from: ["DRAFT", "QUOTATION_REQUESTED", "QUOTED", "BOOKED", "IN_TRANSIT", "ARRIVED", "CUSTOMS_CLEARANCE", "EXCEPTION"] }
];

const SOURCE_LABEL: Record<string, string> = {
  "manual-customer": "إدخال يدوي — العميل",
  "manual-provider": "إدخال يدوي — المزود",
  "manual-staff": "إدخال يدوي — فريق المنصة",
  imported: "مستورد من تكامل",
  external_verified: "خارجي موثّق"
};

const PARTY_ROLES = [
  "SHIPPER",
  "CONSIGNEE",
  "FREIGHT_FORWARDER",
  "CARRIER",
  "CUSTOMS_BROKER",
  "WAREHOUSE"
];

const PARTY_ROLE_LABEL: Record<string, string> = {
  SHIPPER: "الشاحن",
  CONSIGNEE: "المرسل إليه",
  FREIGHT_FORWARDER: "وكيل شحن",
  CARRIER: "ناقل",
  CUSTOMS_BROKER: "مخلّص جمركي",
  WAREHOUSE: "مستودع"
};

const PERMISSION_LABEL: Record<string, string> = {
  canView: "مشاهدة الشحنة",
  canUpdateStatus: "تحديث الحالة",
  canUploadDocuments: "رفع مستندات",
  canViewDocuments: "رؤية المستندات المشتركة",
  canViewFinancials: "رؤية البيانات المالية",
  canQuote: "تقديم عرض",
  canManageParties: "إدارة الأطراف",
  canConfirmDelivery: "تأكيد التسليم"
};

const SENSITIVE = new Set(["canViewFinancials", "canQuote", "canManageParties", "canConfirmDelivery"]);

interface Party {
  id: string;
  companyId: string;
  partyRole: string;
  canView: boolean;
  canUpdateStatus: boolean;
  canUploadDocuments: boolean;
  canViewDocuments: boolean;
  canViewFinancials: boolean;
  canQuote: boolean;
  canManageParties: boolean;
  canConfirmDelivery: boolean;
  company: { id: string; name: string; type: string; organizationId?: string | null };
}

function emptyPermissions() {
  return {
    canView: true,
    canUpdateStatus: false,
    canUploadDocuments: false,
    canViewDocuments: false,
    canViewFinancials: false,
    canQuote: false,
    canManageParties: false,
    canConfirmDelivery: false
  };
}

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [shipment, setShipment] = useState<any>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [tracking, setTracking] = useState<any>(null);
  const [eventForm, setEventForm] = useState({ code: "IN_TRANSIT", note: "" });
  const [eventLoading, setEventLoading] = useState(false);
  const [newParty, setNewParty] = useState({
    companyId: "",
    partyRole: "FREIGHT_FORWARDER",
    permissions: emptyPermissions()
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const [shipmentRes, contextRes, directoryRes] = await Promise.all([
        apiFetch(`/api/v1/shipments/${id}`),
        apiFetch("/api/v1/company"),
        apiFetch("/api/v1/companies/directory")
      ]);
      setShipment(shipmentRes);
      setPermissions(new Set(contextRes.context?.permissions ?? []));
      setCompanies(directoryRes.items ?? []);
      try {
        setTracking(await apiFetch(`/api/v1/shipments/${id}/tracking`));
      } catch {
        setTracking(null);
      }
      try {
        setIntelligence(await apiFetch(`/api/v1/shipments/${id}/intelligence`));
      } catch {
        setIntelligence(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل الشحنة");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = shipment?.viewerRole === "owner";
  const canUpdate =
    permissions.has("shipments.update") && (isOwner || Boolean(shipment?.access?.canUpdateStatus));
  const canManageParties =
    permissions.has("shipments.parties.manage") &&
    (isOwner || Boolean(shipment?.access?.canManageParties));
  const canDelete = permissions.has("shipments.delete") && isOwner;
  const nextStatuses = useMemo(() => NEXT_STATUS[shipment?.status] ?? [], [shipment?.status]);
  const availableEvents = useMemo(
    () => EVENT_OPTIONS.filter((event) => event.from.includes(shipment?.status)),
    [shipment?.status]
  );

  useEffect(() => {
    if (availableEvents.length > 0 && !availableEvents.some((event) => event.code === eventForm.code)) {
      setEventForm((current) => ({ ...current, code: availableEvents[0].code }));
    }
  }, [availableEvents, eventForm.code]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تنفيذ العملية");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus() {
    if (!nextStatus) return;
    await run(async () => {
      await apiFetch(`/api/v1/shipments/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      setNextStatus("");
    }, "تم تحديث حالة الشحنة.");
  }

  async function addEvent() {
    if (!eventForm.code) return;
    setEventLoading(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/shipments/${id}/events`, {
        method: "POST",
        body: JSON.stringify({
          code: eventForm.code,
          note: eventForm.note.trim() || undefined,
          source: "manual",
          idempotencyKey: crypto.randomUUID()
        })
      });
      setEventForm((current) => ({ ...current, note: "" }));
      setNotice("تم تسجيل الحدث اليدوي مع مصدره. التتبع اللحظي غير متاح.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل حدث الشحنة.");
    } finally {
      setEventLoading(false);
    }
  }

  async function refreshIntelligence() {
    setIntelligenceLoading(true);
    setError("");
    try {
      setIntelligence(await apiFetch(`/api/v1/shipments/${id}/intelligence/refresh`, { method: "POST" }));
      setNotice("تم تحديث تقييم المخاطر وتقدير التأخير من البيانات المسجلة.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحديث تقييم الشحنة");
    } finally {
      setIntelligenceLoading(false);
    }
  }

  async function togglePartyPermission(party: Party, key: string, value: boolean) {
    await run(async () => {
      await apiFetch(`/api/v1/shipments/${id}/parties/${party.id}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: { [key]: value } })
      });
    }, "تم تحديث صلاحيات الطرف.");
  }

  async function addParty() {
    await run(async () => {
      await apiFetch(`/api/v1/shipments/${id}/parties`, {
        method: "POST",
        body: JSON.stringify(newParty)
      });
      setNewParty({ companyId: "", partyRole: "FREIGHT_FORWARDER", permissions: emptyPermissions() });
    }, "تمت إضافة الطرف.");
  }

  async function removeParty(party: Party) {
    if (!window.confirm(`إزالة ${party.company.name} من هذه الشحنة؟`)) return;
    await run(async () => {
      await apiFetch(`/api/v1/shipments/${id}/parties/${party.id}`, { method: "DELETE" });
    }, "تمت إزالة الطرف.");
  }

  async function deleteShipment() {
    if (!window.confirm("حذف الشحنة نهائياً؟")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/shipments/${id}`, { method: "DELETE" });
      router.push("/shipments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حذف الشحنة");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !shipment) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        <Link href="/shipments" className="text-sm font-medium text-primary">العودة إلى الشحنات</Link>
      </div>
    );
  }

  if (!shipment) {
    return <EmptyState title="الشحنة غير متاحة" description="قد لا تملك صلاحية الوصول إليها." />;
  }

  const parties: Party[] = shipment.parties ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/shipments" className="text-xs text-slate-500 hover:text-primary">← الشحنات</Link>
          <h1 className="mt-1 font-mono text-2xl font-bold text-navy">{shipment.reference}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {shipment.originPort?.name ?? shipment.originPortId} ← {shipment.destinationPort?.name ?? shipment.destinationPortId}
            {" · "}{shipment.mode} · {shipment.incoterm}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? <Badge variant="success">شحنة شركتك</Badge> : <Badge variant="info">طرف مشارك</Badge>}
          <Badge variant="neutral">{STATUS_LABEL[shipment.status] ?? shipment.status}</Badge>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm text-teal-dark">{notice}</div>
      ) : null}

      <Card>
        <CardHeader title="بيانات الشحنة" subtitle="لا تُعرض بيانات الطرف الآخر أو مستنداته الخاصة تلقائياً" />
        <dl className="grid gap-4 p-5 text-sm md:grid-cols-2">
          <div>
            <dt className="text-slate-500">وصف البضاعة</dt>
            <dd className="mt-1 text-navy">{shipment.cargoDescription}</dd>
          </div>
          <div>
            <dt className="text-slate-500">الوزن</dt>
            <dd className="mt-1 text-navy">{shipment.weightKg} كجم</dd>
          </div>
          <div>
            <dt className="text-slate-500">عدد الأطراف</dt>
            <dd className="mt-1 text-navy">{parties.length}</dd>
          </div>
          <div>
            <dt className="text-slate-500">المستندات</dt>
            <dd className="mt-1">
              <Link href="/documents" className="font-medium text-primary">إدارة المستندات</Link>
            </dd>
          </div>
        </dl>
        {canUpdate && nextStatuses.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-5">
            <select
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
            >
              <option value="">اختر الحالة التالية</option>
              {nextStatuses.map((status) => (
                <option key={status} value={status}>{STATUS_LABEL[status] ?? status}</option>
              ))}
            </select>
            <Button onClick={() => void updateStatus()} disabled={busy || !nextStatus}>تحديث الحالة</Button>
          </div>
        ) : null}
        {canDelete ? (
          <div className="border-t border-slate-100 p-5">
            <Button variant="danger" onClick={() => void deleteShipment()} disabled={busy}>حذف الشحنة</Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="مراحل الشحنة"
          subtitle="سجل زمني للأحداث اليدوية فقط. لا تُعرض مواقع GPS أو بيانات ناقل أو جمارك غير مسجلة."
        />
        <div className="space-y-4 p-5">
          {tracking?.liveTracking?.available === false ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              التتبع اللحظي غير متاح: {tracking.liveTracking.reason}
            </div>
          ) : null}
          {(tracking?.events ?? []).length === 0 ? (
            <EmptyState title="لا توجد أحداث" description="سجّل أول مرحلة يدوياً إن كنت تملك صلاحية تحديث الشحنة." />
          ) : (
            <ol className="relative space-y-4 border-s border-slate-200 ps-5">
              {(tracking?.events ?? []).map((event: any) => (
                <li key={event.id} className="relative">
                  <span className="absolute -start-[26px] top-1 h-2.5 w-2.5 rounded-full bg-teal" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-navy">{event.label}</p>
                    <span className="ltr-text text-xs text-slate-400">
                      {String(event.occurredAt ?? "").slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="ltr-text">{event.code}</span> ·{" "}
                    {SOURCE_LABEL[event.source] ?? event.source}
                    {event.note ? ` · ${event.note}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {canUpdate && availableEvents.length > 0 ? (
            <div className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_1fr_auto]">
              <select
                aria-label="المرحلة"
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={eventForm.code}
                onChange={(event) => setEventForm((current) => ({ ...current, code: event.target.value }))}
              >
                {availableEvents.map((event) => (
                  <option key={event.code} value={event.code}>{event.label}</option>
                ))}
              </select>
              <Input
                aria-label="ملاحظة الحدث"
                placeholder="ملاحظة اختيارية (مثال: غادر الميناء بعد التأخير)"
                value={eventForm.note}
                onChange={(event) => setEventForm((current) => ({ ...current, note: event.target.value }))}
              />
              <Button isLoading={eventLoading} onClick={() => void addEvent()}>
                تسجيل المرحلة
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="ذكاء الشحنة"
          subtitle="مؤشرات تشغيلية من البيانات المسجلة. ليست تنبؤاً مدرّباً ولا بيانات جوية أو جمركية لحظية."
        />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" isLoading={intelligenceLoading} onClick={() => void refreshIntelligence()}>
              تحديث التقييم
            </Button>
            <Link href="/documents" className="text-sm font-medium text-primary">معالجة المستندات وفحص الاتساق</Link>
          </div>
          {intelligence ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">درجة المخاطر</p>
                  <p className="mt-1 text-2xl font-bold text-navy">{intelligence.risk.score}/100</p>
                  <Badge variant={intelligence.risk.category === "critical" || intelligence.risk.category === "high" ? "error" : intelligence.risk.category === "medium" ? "warning" : "success"}>
                    {intelligence.risk.category}
                  </Badge>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">اكتمال البيانات</p>
                  <p className="mt-1 text-2xl font-bold text-navy">{intelligence.risk.dataCompleteness}%</p>
                  <p className="text-xs text-slate-500">محسوبة من الحقول والمعالم المتاحة</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">تقدير التأخير</p>
                  <p className="mt-1 text-sm font-semibold text-navy">
                    {intelligence.delay.status === "insufficient_data" ? "بيانات غير كافية" : "مدة عبور مرصودة"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {intelligence.delay.estimatedDelayDays === null
                      ? "لا توجد ETA مخططة مسجلة؛ لم يتم اختراع عدد أيام."
                      : `${intelligence.delay.estimatedDelayDays} يوم`}
                  </p>
                </div>
              </div>

              {intelligence.risk.factors.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-navy">عوامل المخاطر</p>
                  <ul className="mt-2 space-y-2">
                    {intelligence.risk.factors.map((factor: any) => (
                      <li key={factor.code} className="rounded-lg border border-slate-100 bg-canvas/60 px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700">{factor.label}</span>
                        <span className="ms-2 text-xs text-slate-500">وزن {factor.weight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-slate-600">لا توجد عوامل مخاطر مسجلة حالياً.</p>
              )}

              {intelligence.risk.recommendations.length > 0 ? (
                <div>
                  <p className="text-sm font-semibold text-navy">إجراءات مقترحة</p>
                  <ul className="mt-1 list-disc space-y-1 pe-5 text-sm text-slate-600">
                    {intelligence.risk.recommendations.map((recommendation: string) => <li key={recommendation}>{recommendation}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="text-xs text-slate-500">
                ملاحظات الاتساق المحفوظة: {intelligence.findings?.length ?? 0} · المستندات المرئية: {intelligence.documents?.length ?? 0}
              </div>
              {Array.isArray(intelligence.limitations) ? (
                <ul className="list-disc space-y-1 pe-5 text-xs text-amber-700">
                  {intelligence.limitations.map((limitation: string) => <li key={limitation}>{limitation}</li>)}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-600">تقييم الشحنة غير متاح لهذا المستخدم أو تعذر تحميله.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="الأطراف المشاركة"
          subtitle={isOwner ? "أنت مالك الشحنة وتتحكم في كل الصلاحيات" : "ترى فقط بياناتك وصلاحياتك، ما لم يُمنح لك مدير الأطراف"}
        />
        <div className="space-y-3 p-5">
          {parties.length === 0 ? (
            <EmptyState title="لا توجد أطراف" description="أضف وكيل شحن أو ناقلاً أو مخلّصاً للمشاركة في الشحنة." />
          ) : null}
          {parties.map((party) => {
            const isMyParty = shipment.myParty?.id === party.id;
            const editable = canManageParties && !(isMyParty && !isOwner);
            return (
              <div key={party.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-navy">{party.company?.name ?? party.companyId}</p>
                    <p className="text-xs text-slate-500">
                      {PARTY_ROLE_LABEL[party.partyRole] ?? party.partyRole}
                      {isMyParty ? " · شركتك" : ""}
                    </p>
                  </div>
                  {editable ? (
                    <Button size="sm" variant="secondary" onClick={() => void removeParty(party)} disabled={busy}>
                      إزالة
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(PERMISSION_LABEL).map(([key, label]) => {
                    const disabled =
                      !editable || (!isOwner && SENSITIVE.has(key)) || (isMyParty && !isOwner);
                    return (
                      <label key={key} className={`flex items-center gap-2 ${disabled ? "opacity-60" : ""}`}>
                        <input
                          type="checkbox"
                          checked={Boolean((party as any)[key])}
                          disabled={disabled || busy}
                          onChange={(event) => void togglePartyPermission(party, key, event.target.checked)}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {canManageParties ? (
        <Card>
          <CardHeader title="إضافة طرف" subtitle="الدعوة تمنح الشركة وصولاً للشحنة فقط، وليس لكل بيانات شركتك" />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <select
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={newParty.companyId}
                onChange={(event) => setNewParty({ ...newParty, companyId: event.target.value })}
              >
                <option value="">اختر شركة من الدليل</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} · {company.type}
                  </option>
                ))}
              </select>
              <select
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={newParty.partyRole}
                onChange={(event) => setNewParty({ ...newParty, partyRole: event.target.value })}
              >
                {PARTY_ROLES.map((role) => (
                  <option key={role} value={role}>{PARTY_ROLE_LABEL[role] ?? role}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(PERMISSION_LABEL).map(([key, label]) => {
                const disabled = !isOwner && SENSITIVE.has(key);
                const checked = Boolean((newParty.permissions as any)[key]);
                return (
                  <label key={key} className={`flex items-center gap-2 ${disabled ? "opacity-60" : ""}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) =>
                        setNewParty({
                          ...newParty,
                          permissions: { ...newParty.permissions, [key]: event.target.checked }
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
            <Button
              onClick={() => void addParty()}
              disabled={busy || !newParty.companyId}
            >
              إضافة الطرف
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

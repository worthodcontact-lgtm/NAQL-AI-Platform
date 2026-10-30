"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PublicHeader from "@/components/layout/PublicHeader";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const COMPANY_TYPES: Array<{ value: string; label: string }> = [
  { value: "forwarder", label: "وكيل شحن / Freight Forwarder" },
  { value: "shipping", label: "خط ملاحي / Ocean Carrier" },
  { value: "shipping_agent", label: "وكيل ملاحي / Shipping Agent" },
  { value: "road_carrier", label: "ناقل بري / Road Carrier" },
  { value: "air", label: "شحن جوي / Air Cargo" },
  { value: "customs", label: "مخلص جمركي / Customs Broker" },
  { value: "warehouse", label: "مستودع / Warehouse" },
  { value: "multimodal", label: "لوجستيات متعددة الوسائط / Multimodal" },
  { value: "carrier", label: "ناقل (قديم) / Carrier" },
  { value: "air_cargo", label: "شحن جوي (قديم) / Air Cargo" }
];

const TYPE_LABEL = Object.fromEntries(COMPANY_TYPES.map((item) => [item.value, item.label]));

const VERIFICATION_LABEL: Record<string, string> = {
  verified: "موثقة",
  pending: "قيد المراجعة",
  unregistered: "مسجلة دون تحقق",
  unverified: "غير موثقة",
  rejected: "مرفوضة"
};

const REGISTRATION_LABEL: Record<string, string> = {
  user_registered: "حساب مسجل",
  manually_entered: "سجل عام",
  imported: "مستورد"
};

const INTEGRATION_LABEL: Record<string, string> = {
  AVAILABLE: "متكامل",
  DEGRADED: "متكامل جزئياً",
  UNAVAILABLE: "غير متاح",
  UNVERIFIED: "غير مؤكد",
  NOT_CONFIGURED: "غير مربوط"
};

function verificationTone(status: string) {
  if (status === "verified") return "text-success";
  if (status === "rejected") return "text-error";
  return "text-warning";
}

export default function DirectoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [mode, setMode] = useState("");
  const [coverage, setCoverage] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [registered, setRegistered] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextPage = page) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (type) params.set("type", type);
      if (mode) params.set("mode", mode);
      if (coverage) params.set("coverage", coverage);
      if (verificationStatus) params.set("verificationStatus", verificationStatus);
      if (registered) params.set("registered", registered);
      params.set("page", String(nextPage));
      params.set("limit", "12");
      const res = await fetch(`${API}/api/v1/companies/directory?${params}`);
      if (!res.ok) throw new Error("تعذر تحميل دليل الشركات.");
      const json = await res.json();
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setHasMore(Boolean(json.hasMore));
      setPage(json.page ?? nextPage);
    } catch (err) {
      setItems([]);
      setTotal(0);
      setHasMore(false);
      setError(err instanceof Error ? err.message : "تعذر تحميل دليل الشركات.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(1);
    // Filters are applied explicitly by the search button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setQ("");
    setType("");
    setMode("");
    setCoverage("");
    setVerificationStatus("");
    setRegistered("");
    setPage(1);
    const params = new URLSearchParams({ page: "1", limit: "12" });
    setLoading(true);
    setError("");
    fetch(`${API}/api/v1/companies/directory?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("تعذر تحميل دليل الشركات.");
        return res.json();
      })
      .then((json) => {
        setItems(json.items ?? []);
        setTotal(json.total ?? 0);
        setHasMore(Boolean(json.hasMore));
        setPage(json.page ?? 1);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "تعذر تحميل دليل الشركات."))
      .finally(() => setLoading(false));
  }

  function goTo(nextPage: number) {
    if (nextPage < 1) return;
    load(nextPage);
  }

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-3xl font-bold text-navy">دليل الشركات اللوجستية</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">
          سجلات تعريفية بمقدمي الخدمات. الإدراج ليس شهادة أو شراكة موثقة، وليس وعداً بسعة أو سعر أو
          تغطية. تظهر حالة التحقق والتسجيل ومصدر البيانات بشكل منفصل. شركات الخطوط الملاحية الدولية
          المدرجة كمرشحين ليست بالضرورة مسجلة في NAQL AI، ولا تعني أن لها وكيلاً أو مكتباً في مصر.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            aria-label="بحث بالاسم أو الخدمة"
            className="rounded-lg border border-slate-200 px-3 py-2"
            placeholder="ابحث بالاسم العربي/الإنجليزي أو الخدمة"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                load(1);
              }
            }}
          />
          <select
            aria-label="فئة مقدم الخدمة"
            className="rounded-lg border border-slate-200 px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">كل الفئات</option>
            {COMPANY_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <select
            aria-label="وسيلة النقل"
            className="rounded-lg border border-slate-200 px-3 py-2"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="">كل وسائل النقل</option>
            <option value="SEA">بحري</option>
            <option value="AIR">جوي</option>
            <option value="LAND">بري</option>
            <option value="RAIL">سكة حديد</option>
            <option value="MULTIMODAL">متعدد الوسائط</option>
          </select>
          <input
            aria-label="نطاق التغطية"
            className="rounded-lg border border-slate-200 px-3 py-2"
            placeholder="مدينة أو ميناء ضمن التغطية"
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
          />
          <select
            aria-label="حالة التحقق"
            className="rounded-lg border border-slate-200 px-3 py-2"
            value={verificationStatus}
            onChange={(e) => setVerificationStatus(e.target.value)}
          >
            <option value="">كل حالات التحقق</option>
            <option value="verified">موثقة</option>
            <option value="pending">قيد المراجعة</option>
            <option value="unverified">غير موثقة</option>
            <option value="unregistered">مسجلة دون تحقق</option>
            <option value="rejected">مرفوضة</option>
          </select>
          <select
            aria-label="حالة الحساب"
            className="rounded-lg border border-slate-200 px-3 py-2"
            value={registered}
            onChange={(e) => setRegistered(e.target.value)}
          >
            <option value="">مسجلة وغير مسجلة</option>
            <option value="true">لديها حساب مسجل</option>
            <option value="false">سجل عام فقط</option>
          </select>
          <button
            onClick={() => {
              setPage(1);
              load(1);
            }}
            className="rounded-lg bg-primary px-5 py-2 text-white"
          >
            بحث
          </button>
          <button
            onClick={reset}
            className="rounded-lg border border-slate-200 px-5 py-2 text-slate-600"
          >
            إعادة ضبط
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-error">
            {error}
            <button onClick={() => load(page)} className="mr-3 font-semibold underline">إعادة المحاولة</button>
          </div>
        )}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            <p className="mt-6 text-xs text-slate-500">{total} نتيجة</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => {
                const label = c.nameAr || c.name;
                return (
                  <Link key={c.id} href={`/directory/${c.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold text-navy">{label}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                        {c.isRegistered ? "حساب مسجل" : "سجل عام"}
                      </span>
                    </div>
                    {c.nameEn && c.nameEn !== label && <p className="text-xs text-slate-400">{c.nameEn}</p>}
                    <p className="mt-1 text-sm text-slate-500">{TYPE_LABEL[c.type] ?? c.type} · {c.country ?? "—"}</p>
                    <p className="mt-2 line-clamp-2 text-xs text-slate-600">
                      {c.services?.length
                        ? c.services
                            .slice(0, 2)
                            .map((s: any) => `${s.mode}${s.serviceType ? `/${s.serviceType}` : ""}: ${s.originLocation ?? "—"} → ${s.destinationLocation ?? "—"}`)
                            .join(" · ")
                        : "لا توجد خدمات أو تغطية منشورة"}
                    </p>
                    <p className={`mt-3 text-xs font-semibold ${verificationTone(c.verificationStatus)}`}>
                      {VERIFICATION_LABEL[c.verificationStatus] ?? c.verificationStatus}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      المصدر: {REGISTRATION_LABEL[c.recordOrigin] ?? c.recordOrigin ?? "غير محدد"}
                      {c.lastVerifiedAt
                        ? ` · آخر تحقق ${String(c.lastVerifiedAt).slice(0, 10)}`
                        : " · لم يُتحقق منه مستقلاً"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      الأسعار: {INTEGRATION_LABEL[c.pricingIntegrationStatus] ?? c.pricingIntegrationStatus} ·
                      التوافر: {INTEGRATION_LABEL[c.availabilityIntegrationStatus] ?? c.availabilityIntegrationStatus}
                    </p>
                  </Link>
                );
              })}
              {items.length === 0 && !error && (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
                  لا توجد شركات مطابقة لهذه الفلاتر.
                </div>
              )}
            </div>
            {(page > 1 || hasMore) && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={() => goTo(page - 1)}
                  disabled={page <= 1 || loading}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-40"
                >
                  السابق
                </button>
                <span className="text-sm text-slate-500">صفحة {page}</span>
                <button
                  onClick={() => goTo(page + 1)}
                  disabled={!hasMore || loading}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm disabled:opacity-40"
                >
                  التالي
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

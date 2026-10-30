"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PublicHeader from "@/components/layout/PublicHeader";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const TYPE_LABEL: Record<string, string> = {
  importer_exporter: "مستورد / مصدر",
  forwarder: "وكيل شحن / Freight Forwarder",
  shipping: "خط ملاحي / Ocean Carrier",
  shipping_agent: "وكيل ملاحي / Shipping Agent",
  carrier: "ناقل (قديم)",
  road_carrier: "ناقل بري / Road Carrier",
  air: "شحن جوي / Air Cargo",
  air_cargo: "شحن جوي / Air Cargo",
  customs: "مخلص جمركي / Customs Broker",
  warehouse: "مستودع / Warehouse",
  multimodal: "لوجستيات متعددة الوسائط / Multimodal"
};

const VERIFICATION_LABEL: Record<string, string> = {
  verified: "موثقة من NAQL AI",
  pending: "التحقق قيد المراجعة",
  unregistered: "مسجلة دون تحقق",
  unverified: "غير موثقة",
  rejected: "لم تجتز التحقق الإداري"
};

const ORIGIN_LABEL: Record<string, string> = {
  user_registered: "سجل أنشأته الشركة",
  manually_entered: "سجل عام أُدخل يدوياً",
  imported: "سجل مستورد"
};

const INTEGRATION_LABEL: Record<string, string> = {
  AVAILABLE: "مربوط ومتاح",
  DEGRADED: "مربوط جزئياً",
  UNAVAILABLE: "غير متاح",
  UNVERIFIED: "غير مؤكد",
  NOT_CONFIGURED: "غير مربوط"
};

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/v1/companies/${params.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("الشركة غير موجودة أو غير مدرجة.");
        return r.json();
      })
      .then(setCompany)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto max-w-4xl px-5 py-10 text-slate-500">جار التحميل...</main>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto max-w-4xl px-5 py-10">
          <p role="alert" className="text-error">{error}</p>
          <Link href="/directory" className="mt-4 inline-block text-sm text-primary">← رجوع للدليل</Link>
        </main>
      </>
    );
  }
  if (!company) return null;

  const displayName = company.nameAr || company.name;

  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-4xl px-5 py-10">
        <Link href="/directory" className="text-sm text-primary">← رجوع للدليل</Link>
        <h1 className="mt-4 text-3xl font-bold text-navy">{displayName}</h1>
        {company.nameEn && company.nameEn !== displayName && (
          <p className="text-sm text-slate-400">{company.nameEn}</p>
        )}
        <p className="text-sm text-slate-500">
          {TYPE_LABEL[company.type] ?? company.type} · {company.country ?? "—"} · {company.isRegistered ? "حساب مسجل" : "سجل عام فقط"}
        </p>
        <p className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {VERIFICATION_LABEL[company.verificationStatus] ?? company.verificationStatus}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          الإدراج في الدليل لا يمنح حساباً أو وصولاً إلى بوابة أو صلاحية استلام طلبات عروض خاصة.
          شركات الخطوط الملاحية الدولية المدرجة كمرشحين ليست بالضرورة مسجلة في NAQL AI ولا تعني وجود
          وكيل أو مكتب في مصر.
        </p>

        {company.description && <p className="mt-5 text-slate-600">{company.description}</p>}

        <section className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-slate-400">حالة الحساب</p>
            <p className="font-semibold text-navy">{company.isRegistered ? "حساب مسجل في NAQL AI" : "سجل عام (غير مسجل)"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">مصدر السجل</p>
            <p className="font-semibold text-navy">{ORIGIN_LABEL[company.recordOrigin] ?? company.recordOrigin ?? "غير محدد"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">بيانات المصدر</p>
            <p className="text-slate-600">{company.dataSource ?? "غير محدد"}</p>
            {company.sourceUrl && (
              <a href={company.sourceUrl} target="_blank" rel="noreferrer" className="ltr-text text-xs text-primary underline">
                {company.sourceUrl}
              </a>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400">آخر تحقق مستقل</p>
            <p className="text-slate-600">
              {company.lastVerifiedAt
                ? String(company.lastVerifiedAt).slice(0, 10)
                : "لم يُتحقق منه مستقلاً. البيانات التعريفية فقط."}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">تكامل الأسعار</p>
            <p className="text-slate-600">{INTEGRATION_LABEL[company.pricingIntegrationStatus] ?? company.pricingIntegrationStatus}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">تكامل التوافر</p>
            <p className="text-slate-600">{INTEGRATION_LABEL[company.availabilityIntegrationStatus] ?? company.availabilityIntegrationStatus}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">الموقع / المصدر الرسمي</p>
            {company.website ? (
              <a href={company.website} target="_blank" rel="noreferrer" className="ltr-text text-primary underline">
                {company.website}
              </a>
            ) : (
              <p className="text-slate-500">غير منشور</p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400">بيانات الاتصال المنشورة</p>
            {company.contactPublished ? (
              <div className="text-slate-600">
                {company.email && <p className="ltr-text">{company.email}</p>}
                {company.phone && <p className="ltr-text">{company.phone}</p>}
                <p className="mt-1 text-[11px] text-slate-400">نشرتها الشركة بموافقتها؛ لم يتحقق منها فريق NAQL AI.</p>
              </div>
            ) : (
              <p className="text-slate-500">لا توجد بيانات اتصال منشورة بموافقة الشركة.</p>
            )}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold text-navy">الخدمات والتغطية</h2>
          <p className="mt-1 text-xs text-slate-500">بيانات وصفية مقدمة من الشركة أو من سجل عام، وليست سعراً أو التزاماً بسعة.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {(company.services ?? []).length === 0 && (
              <p className="text-sm text-slate-500">لا توجد خدمات أو تغطية منشورة.</p>
            )}
            {(company.services ?? []).map((s: any) => (
              <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                <p className="font-semibold text-navy">{s.mode}{s.serviceType ? ` · ${s.serviceType}` : ""}</p>
                <p className="text-slate-500">{s.originLocation ?? "—"} → {s.destinationLocation ?? "—"}</p>
                {s.shipmentTypes?.length ? (
                  <p className="mt-2 text-xs text-slate-500">أنواع الشحنات: {s.shipmentTypes.join(" · ")}</p>
                ) : null}
                {s.notes ? <p className="mt-2 text-slate-600">{s.notes}</p> : null}
              </div>
            ))}
          </div>
        </section>

        {!company.isRegistered && (
          <section className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-5">
            <h2 className="font-semibold text-navy">هل تمثل هذه الشركة؟</h2>
            <p className="mt-1 text-sm text-slate-600">
              أنشئ حساب شركة وقدّم بياناتك للتحقق. الإدراج العام الحالي لا يمنحك بوابة أو صلاحية استلام
              طلبات عروض خاصة.
            </p>
            <Link href="/company/register" className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-sm text-white">
              تسجيل الشركة
            </Link>
          </section>
        )}
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { apiFetch, downloadFile } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/components/providers/AuthProvider";

// A provider profile always uses a logistics category. The legacy
// `importer_exporter` company type remains readable for existing records but is
// not offered as a provider onboarding category.
const COMPANY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "forwarder", label: "وكيل شحن / Freight Forwarder" },
  { value: "shipping", label: "خط ملاحي / Ocean Carrier" },
  { value: "shipping_agent", label: "وكيل ملاحي / Shipping Agent" },
  { value: "road_carrier", label: "ناقل بري / Road Carrier" },
  { value: "air", label: "شحن جوي / Air Cargo Provider" },
  { value: "customs", label: "مخلص جمركي / Customs Broker" },
  { value: "warehouse", label: "مستودع / Warehouse Provider" },
  { value: "multimodal", label: "لوجستيات متعددة الوسائط / Multimodal" },
  { value: "carrier", label: "ناقل (نوع قديم)" }
];

const COMPANY_TYPE_LABEL = {
  importer_exporter: "مستورد / مصدّر (تصنيف قديم غير مؤهل للعروض)",
  ...Object.fromEntries(COMPANY_TYPE_OPTIONS.map((type) => [type.value, type.label]))
} as Record<string, string>;

const DOCUMENT_TYPES: Record<string, string> = {
  commercial_register: "السجل التجاري",
  tax_card: "البطاقة الضريبية",
  license: "الترخيص",
  insurance: "التأمين",
  other: "مستند آخر"
};

const SCAN_LABEL: Record<string, string> = {
  not_scanned: "لم يُفحص",
  pending: "قيد الفحص",
  clean: "سليم",
  infected: "محجوز",
  scan_unavailable: "الماسح غير متاح",
  scan_failed: "فشل الفحص"
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
    reader.readAsDataURL(file);
  });
}

function CompanyDocuments({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [type, setType] = useState("commercial_register");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/v1/companies/${companyId}/documents`);
      setItems(res.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل مستندات الشركة.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function upload() {
    if (!file) return;
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) {
      setError("يُسمح فقط بملفات PDF أو PNG أو JPEG.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/api/v1/companies/${companyId}/documents`, {
        method: "POST",
        body: JSON.stringify({
          type,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          dataBase64: await fileToBase64(file)
        })
      });
      setFile(null);
      setNotice("تم رفع المستند وتسجيله للمراجعة.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر رفع مستند الشركة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-canvas/40 p-4">
      <p className="text-sm font-semibold text-navy">مستندات التحقق</p>
      <p className="mt-1 text-xs text-slate-500">
        تُخزّن الملفات بمفاتيح يولّدها الخادم خارج جذر الويب. لا يُقبل إلا PDF أو PNG أو JPEG بعد التحقق من البصمة.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto]">
        <select
          aria-label="نوع المستند"
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {Object.entries(DOCUMENT_TYPES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          aria-label="ملف المستند"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <Button size="sm" isLoading={busy} disabled={!file} onClick={() => void upload()}>
          رفع المستند
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
      {notice ? <p className="mt-2 text-xs text-teal-dark">{notice}</p> : null}
      {loading ? <p className="mt-3 text-xs text-slate-500">جارٍ تحميل المستندات…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">لا توجد مستندات مرفوعة بعد.</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {items.map((document) => (
          <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-navy">{document.filename}</p>
              <p className="text-xs text-slate-500">
                {DOCUMENT_TYPES[document.type] ?? document.type} ·{" "}
                {document.size ? `${Math.ceil(document.size / 1024)} KB` : "بدون حجم"} ·{" "}
                <Badge variant={document.malwareScanStatus === "infected" ? "error" : document.malwareScanStatus === "clean" ? "success" : "warning"}>
                  {SCAN_LABEL[document.malwareScanStatus] ?? document.malwareScanStatus}
                </Badge>
              </p>
            </div>
            {document.hasContent ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void downloadFile(
                    `/api/v1/companies/${companyId}/documents/${document.id}/content`,
                    document.filename
                  ).catch((err) => setError(err instanceof Error ? err.message : "تعذر تنزيل المستند."))
                }
              >
                تنزيل
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CompanyRegisterPage() {
  const { refresh } = useAuth();
  const [onboarding, setOnboarding] = useState(false);
  const [mine, setMine] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    nameAr: "",
    nameEn: "",
    type: "forwarder",
    country: "EG",
    description: "",
    website: "",
    email: "",
    phone: "",
    publicContactConsent: false,
    mode: "SEA",
    serviceType: "",
    originLocation: "",
    destinationLocation: "",
    shipmentTypes: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadMine() {
    try {
      const res = await apiFetch("/api/v1/companies/mine");
      setMine(res.items ?? []);
    } catch { /* optional */ }
  }

  useEffect(() => {
    setOnboarding(new URLSearchParams(window.location.search).get("onboarding") === "provider");
    void loadMine();
  }, []);

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(""); setNotice("");
    try {
      const services =
        form.originLocation || form.destinationLocation || form.serviceType || form.shipmentTypes
          ? [{
              mode: form.mode,
              serviceType: form.serviceType || undefined,
              originLocation: form.originLocation || undefined,
              destinationLocation: form.destinationLocation || undefined,
              shipmentTypes: form.shipmentTypes
                ? form.shipmentTypes.split(",").map((item) => item.trim()).filter(Boolean)
                : undefined
            }]
          : undefined;
      await apiFetch("/api/v1/companies/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          nameAr: form.nameAr || undefined,
          nameEn: form.nameEn || undefined,
          type: form.type,
          country: form.country || undefined,
          description: form.description || undefined,
          website: form.website || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          publicContactConsent: form.publicContactConsent,
          services
        })
      });
      setNotice("تم إنشاء ملف الشركة وتحويل مساحة العمل إلى حساب مزوّد خدمة. أرسل الملف للمراجعة عند الحاجة.");
      await loadMine();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function submit(id: string) {
    await apiFetch(`/api/v1/companies/${id}/submit`, { method: "POST", body: JSON.stringify({}) });
    await loadMine();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">ملف مزوّد الخدمة</h1>
        <p className="mt-1 text-sm text-slate-600">
          هذه الخطوة مخصصة لمنظمات الخدمات اللوجستية. إنشاء الملف لا يمنح التحقق، ولا ينشئ
          عضوية إضافية: الأعضاء الحاليون في مساحة العمل هم من يديرون الملف حسب أدوارهم.
        </p>
      </div>

      {onboarding && (
        <div className="rounded-xl border border-teal/30 bg-teal/10 px-4 py-3 text-sm text-teal-dark">
          تم إنشاء حساب مزوّد الخدمة. أكمل بيانات المنشأة وفئات الخدمة أدناه. الانضمام إلى طلبات
          العروض يتاح بعد وجود ملف شركة مؤهل، وليس بمجرد التسجيل.
        </div>
      )}

      <Card>
        <CardHeader
          title="تسجيل منشأة مزوّدة"
          subtitle="إنشاء الملف لا يعني التحقق. يجب إرسال الملف لمراجعة NAQL AI. تسجيل الملف يحوّل مساحة العمل إلى حساب مزوّد خدمة."
        />
        <form onSubmit={register} className="grid gap-3 p-5 md:grid-cols-2">
          <Input label="الاسم القانوني" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="الاسم بالعربية" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          <Input label="الاسم بالإنجليزية" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          <label className="space-y-1 text-sm">
            <span className="block font-medium text-slate-600">فئة مقدم الخدمة</span>
            <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {COMPANY_TYPE_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </label>
          <Input label="الدولة" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <Input label="الموقع الإلكتروني" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" />
          <Input label="البريد الرسمي" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div className="md:col-span-2">
            <Textarea label="وصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.publicContactConsent}
              onChange={(e) => setForm({ ...form, publicContactConsent: e.target.checked })}
            />
            <span className="text-slate-600">
              أوافق على نشر البريد والهاتف في الدليل العام. بدون موافقة صريحة لا يعرضهما NAQL AI.
              النشر لا يعني أن الفريق تحقق منهما.
            </span>
          </label>
          <div className="rounded-xl border border-slate-200 bg-canvas/40 p-4 md:col-span-2">
            <p className="text-sm font-semibold text-navy">خدمة وتغطية اختيارية</p>
            <p className="mt-1 text-xs text-slate-500">بيانات وصفية فقط. لا تُفسر كسعر أو سعة أو توافر مؤكد.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="block font-medium text-slate-600">وسيلة النقل</span>
                <select className="w-full rounded-lg border border-slate-200 px-3 py-2" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option value="SEA">بحري</option>
                  <option value="AIR">جوي</option>
                  <option value="LAND">بري</option>
                  <option value="RAIL">سكة حديد</option>
                  <option value="MULTIMODAL">متعدد الوسائط</option>
                </select>
              </label>
              <Input label="نوع الخدمة" value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} placeholder="ocean_freight / customs_clearance..." />
              <Input label="من" value={form.originLocation} onChange={(e) => setForm({ ...form, originLocation: e.target.value })} />
              <Input label="إلى" value={form.destinationLocation} onChange={(e) => setForm({ ...form, destinationLocation: e.target.value })} />
              <div className="md:col-span-2">
                <Input label="أنواع الشحنات (مفصولة بفواصل)" value={form.shipmentTypes} onChange={(e) => setForm({ ...form, shipmentTypes: e.target.value })} placeholder="FCL, LCL, GENERAL_CARGO" />
              </div>
            </div>
          </div>
          <div className="md:col-span-2"><Button isLoading={loading} type="submit">تسجيل الشركة</Button></div>
        </form>
        {notice && <p className="px-5 pb-5 text-sm text-teal-dark">{notice}</p>}
        {error && <p className="px-5 pb-5 text-error">{error}</p>}
      </Card>

      <Card>
        <CardHeader title="شركاتي" />
        <div className="space-y-3 p-5">
          {mine.length === 0 && <EmptyState title="لا توجد شركات" description="سجّل شركتك للظهور في الدليل." />}
          {mine.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy">{c.name}</p>
                  <p className="text-sm text-slate-500">
                    {COMPANY_TYPE_LABEL[c.type] ?? c.type} · {c.status} · {c.verificationStatus}
                  </p>
                </div>
                {["draft", "needs_information"].includes(c.status) && <Button variant="secondary" onClick={() => submit(c.id)}>إرسال للمراجعة</Button>}
              </div>
              <CompanyDocuments companyId={c.id} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

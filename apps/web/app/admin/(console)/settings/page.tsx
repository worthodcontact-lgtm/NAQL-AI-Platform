"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import {
  AdminPageHeader,
  ErrorPanel,
  LoadingPanel
} from "@/components/admin/ui";
import { adminFetch } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface Settings {
  platform: { platformName: string; supportEmail: string | null; maintenanceMessage: string | null };
  environment: {
    nodeEnv: string;
    persistenceMode: string;
    database: string;
    adminSeparateLogin: boolean;
    sessionVersioning: boolean;
    auditLog: boolean;
  };
  integrations: {
    ai: { provider: string; configured: boolean };
    tradeData: { provider: string; configured: boolean };
  };
  editableKeys: string[];
}

export default function AdminSettingsPage() {
  const { has } = useAdminAuth();
  const { data, loading, error, reload } = useAdminResource<Settings>("/api/v1/admin/settings");

  const [form, setForm] = useState({ platformName: "", supportEmail: "", maintenanceMessage: "" });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      platformName: data.platform.platformName,
      supportEmail: data.platform.supportEmail ?? "",
      maintenanceMessage: data.platform.maintenanceMessage ?? ""
    });
  }, [data]);

  const canManage = has("settings.manage");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaveError(null);
    setSaved(null);
    try {
      const body: Record<string, string> = {};
      if (form.platformName.trim() !== data?.platform.platformName) body.platformName = form.platformName.trim();
      if ((form.supportEmail.trim() || null) !== (data?.platform.supportEmail ?? null)) {
        body.supportEmail = form.supportEmail.trim();
      }
      if ((form.maintenanceMessage.trim() || null) !== (data?.platform.maintenanceMessage ?? null)) {
        body.maintenanceMessage = form.maintenanceMessage.trim();
      }
      if (Object.keys(body).length === 0) {
        setSaveError("لم تتغير أي قيمة.");
        return;
      }
      const result = await adminFetch("/api/v1/admin/settings", { method: "PUT", body: JSON.stringify(body) });
      setSaved(result?.updated ?? Object.keys(body));
      reload();
    } catch (caught: any) {
      setSaveError(caught?.message ?? "تعذّر حفظ الإعدادات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="الإعدادات"
        description="إعدادات تشغيلية عامة وحالة التكاملات. لا تحتوي هذه الصفحة على أي أسرار أو محرر متغيرات بيئة."
      />

      {loading && <LoadingPanel label="جارٍ تحميل الإعدادات..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-navy">إعدادات المنصة العامة</h2>
                <p className="mt-1 text-xs text-slate-500">
                  الحقول المسموح تعديلها: {data.editableKeys.join(" · ")}
                </p>
              </div>
              {!canManage && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                  قراءة فقط لدورك
                </span>
              )}
            </div>

            {saved && (
              <p className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                تم حفظ التغييرات وتسجيلها في سجل التدقيق: {saved.join(" · ")}
              </p>
            )}
            {saveError && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{saveError}</p>
            )}

            <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-600">اسم المنصة</span>
                <input
                  value={form.platformName}
                  onChange={(event) => setForm({ ...form, platformName: event.target.value })}
                  disabled={!canManage}
                  minLength={2}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-canvas"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-600">بريد الدعم</span>
                <input
                  type="email"
                  value={form.supportEmail}
                  onChange={(event) => setForm({ ...form, supportEmail: event.target.value })}
                  disabled={!canManage}
                  placeholder="support@example.com"
                  className="ltr-text w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-canvas"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-600">رسالة الصيانة (تظهر عند تفعيلها لاحقاً)</span>
                <textarea
                  value={form.maintenanceMessage}
                  onChange={(event) => setForm({ ...form, maintenanceMessage: event.target.value })}
                  disabled={!canManage}
                  rows={3}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-canvas"
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={!canManage || busy}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
                </button>
              </div>
            </form>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-sm font-bold text-navy">بيئة التشغيل</h2>
              <p className="mb-4 mt-1 text-xs text-slate-500">قيم للقراءة فقط من إعدادات الخادم</p>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">NODE_ENV</dt>
                  <dd className="ltr-text font-semibold text-slate-700">{data.environment.nodeEnv}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">وضع التخزين</dt>
                  <dd className="font-semibold text-slate-700">
                    {data.environment.persistenceMode === "database" ? "PostgreSQL" : data.environment.persistenceMode}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-slate-500">قاعدة البيانات</dt>
                  <dd className={`font-semibold ${data.environment.database === "connected" ? "text-green-700" : "text-red-700"}`}>
                    {data.environment.database === "connected" ? "متصلة" : "غير متاحة"}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 space-y-2">
                {[
                  { label: "دخول إداري منفصل", value: data.environment.adminSeparateLogin },
                  { label: "إلغاء الجلسات بتغيير الصلاحية", value: data.environment.sessionVersioning },
                  { label: "سجل تدقيق دائم", value: data.environment.auditLog }
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-xs">
                    <span className="text-slate-600">{item.label}</span>
                    <span className={item.value ? "font-semibold text-green-700" : "font-semibold text-red-700"}>
                      {item.value ? "مفعّل" : "غير مفعّل"}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h2 className="text-sm font-bold text-navy">التكاملات الخارجية</h2>
              <p className="mb-4 mt-1 text-xs leading-relaxed text-slate-500">
                يوضح هذا القسم وجود الإعداد فقط. وجود مفتاح لا يثبت أن المزود يعمل، لذلك لا تُصنَّف أي خدمة كـ«متصلة».
              </p>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">الذكاء الاصطناعي</p>
                    <span className={`text-xs font-semibold ${data.integrations.ai.configured ? "text-amber-700" : "text-slate-500"}`}>
                      {data.integrations.ai.configured ? "مُهيأ (غير مُتحقق)" : "غير مُهيأ"}
                    </span>
                  </div>
                  <p className="ltr-text mt-1 text-[11px] text-slate-500">provider: {data.integrations.ai.provider}</p>
                </div>
                <div className="rounded-xl border border-slate-100 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-700">بيانات التجارة</p>
                    <span className={`text-xs font-semibold ${data.integrations.tradeData.configured ? "text-amber-700" : "text-slate-500"}`}>
                      {data.integrations.tradeData.configured ? "مفتاح موجود (غير مُتحقق)" : "غير مُهيأ"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{data.integrations.tradeData.provider}</p>
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <h2 className="text-sm font-bold text-navy">الأمان وتوفير الحسابات</h2>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-600">
              <li>• لا توجد أي واجهة عامة لإنشاء حساب إداري أو ترقيته. الحسابات تُنشأ عبر أداة خادم محمية فقط.</li>
              <li>• تُخزَّن كلمات المرور بصيغة bcrypt، ولا تُسجَّل أو تُعاد في أي استجابة.</li>
              <li>• إيقاف الحساب أو تغيير دوره يلغي جلساته القائمة عبر إصدار الجلسة.</li>
              <li>• لا يمكن تعديل متغيرات البيئة أو الأسرار من هذه الصفحة؛ الأسرار تبقى في بيئة الخادم.</li>
              <li>• الإجراءات الحساسة تُسجَّل في سجل تدقيق إضافي مع معرّف طلب وملخص آمن.</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

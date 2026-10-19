"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { AdminPageHeader, ErrorPanel, LoadingPanel, StatusBadge } from "@/components/admin/ui";
import { COMPANY_TYPE_LABEL, adminFetch, formatDate } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface CompanyDetail {
  company: {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    verificationStatus: string;
    listed: boolean;
    description: string | null;
    country: string | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    organizationId: string | null;
    createdAt: string;
    updatedAt: string;
    services: { id: string; mode: string; originLocation: string | null; destinationLocation: string | null; notes: string | null }[];
    documents: { id: string; type: string; filename: string; status: string; reviewNote: string | null; uploadedAt: string }[];
    reviews: { id: string; reviewerUserId: string; decision: string; notes: string | null; createdAt: string }[];
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    memberships: { id: string; role: string; user: { id: string; email: string; displayName: string; status: string } }[];
  } | null;
}

export default function AdminCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { user: currentUser, has } = useAdminAuth();
  const { data, loading, error, reload } = useAdminResource<CompanyDetail>(id ? `/api/v1/admin/companies/${id}` : null);

  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("approved");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const company = data?.company;
  const ownCompany = Boolean(company?.organizationId && company.organizationId === currentUser?.organizationId);
  const canVerify = has("companies.verify") && !ownCompany;

  async function submitDecision() {
    if (!company) return;
    setBusy(true);
    setDialogError(null);
    try {
      await adminFetch(`/api/v1/admin/companies/${company.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, notes: notes.trim() || undefined })
      });
      setOpen(false);
      setNotes("");
      reload();
    } catch (caught: any) {
      setDialogError(caught?.message ?? "تعذّر تسجيل القرار");
    } finally {
      setBusy(false);
    }
  }

  const notesRequired = decision !== "approved";
  const canConfirm = !notesRequired || notes.trim().length >= 3;

  return (
    <div>
      <AdminPageHeader
        title={company?.name ?? "تفاصيل الشركة"}
        description="ملف الشركة والوثائق وسجل قرارات التحقق. قرار المنصة داخلي ولا يُعد اعتماداً حكومياً."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/companies" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              ← العودة للشركات
            </Link>
            {canVerify && (
              <button
                onClick={() => {
                  setOpen(true);
                  setDecision("approved");
                  setNotes("");
                  setDialogError(null);
                }}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
              >
                تسجيل قرار تحقق
              </button>
            )}
          </div>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل ملف الشركة..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          {ownCompany && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              هذه الشركة مرتبطة بمنظمتك. لا يمكنك تسجيل قرار تحقق عليها لتجنب تضارب المصالح.
            </p>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge value={data.company.verificationStatus} />
                  <StatusBadge value={data.company.status} />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                    {COMPANY_TYPE_LABEL[data.company.type] ?? data.company.type}
                  </span>
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
                  {data.company.description || "لا يوجد وصف مسجل."}
                </p>
              </div>
              <div className="text-xs text-slate-500">
                <p>سُجلت في {formatDate(data.company.createdAt)}</p>
                <p className="mt-1">آخر تحديث {formatDate(data.company.updatedAt)}</p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">الدولة</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.company.country ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">البريد</dt>
                <dd className="ltr-text mt-1 font-medium text-slate-700">{data.company.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الهاتف</dt>
                <dd className="ltr-text mt-1 font-medium text-slate-700">{data.company.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">الموقع</dt>
                <dd className="ltr-text mt-1 truncate font-medium text-slate-700">{data.company.website ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">الخدمات</h3>
              </div>
              {data.company.services.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد خدمات مسجلة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.company.services.map((service) => (
                    <li key={service.id} className="px-5 py-3 text-sm">
                      <p className="font-medium text-slate-700">{service.mode}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {service.originLocation ?? "—"} ← {service.destinationLocation ?? "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">الوثائق</h3>
                <p className="mt-1 text-xs text-slate-500">بيانات وصفية فقط؛ لا تُعرض مسارات التخزين</p>
              </div>
              {data.company.documents.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد وثائق مرفوعة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.company.documents.map((document) => (
                    <li key={document.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-700">{document.filename}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {document.type} · {formatDate(document.uploadedAt)}
                        </p>
                      </div>
                      <StatusBadge value={document.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {data.organization && (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">المنظمة المالكة</h3>
                <p className="mt-1 text-xs text-slate-500">{data.organization.name}</p>
              </div>
              {data.organization.memberships.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد عضويات مسجلة.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-sm">
                    <thead className="bg-canvas/80">
                      <tr>
                        {["العضو", "البريد", "الدور", "الحالة"].map((header) => (
                          <th key={header} className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.organization.memberships.map((membership) => (
                        <tr key={membership.id}>
                          <td className="px-5 py-3">
                            <Link href={`/admin/users/${membership.user.id}`} className="font-medium text-slate-700 hover:text-primary">
                              {membership.user.displayName}
                            </Link>
                          </td>
                          <td className="ltr-text px-5 py-3 text-xs text-slate-500">{membership.user.email}</td>
                          <td className="px-5 py-3 text-xs text-slate-600">{membership.role}</td>
                          <td className="px-5 py-3">
                            <StatusBadge value={membership.user.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">سجل قرارات التحقق</h3>
            </div>
            {data.company.reviews.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لا توجد قرارات سابقة.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.company.reviews.map((review) => (
                  <li key={review.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge value={review.decision} />
                      <span className="text-xs text-slate-500">{formatDate(review.createdAt)}</span>
                    </div>
                    {review.notes && <p className="mt-2 text-sm text-slate-600">{review.notes}</p>}
                    <p className="ltr-text mt-1 text-[11px] text-slate-400">reviewer: {review.reviewerUserId}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={open}
        title="تسجيل قرار تحقق"
        description="سيُضاف القرار إلى سجل الشركة وإلى سجل التدقيق. القرار لا يمثل اعتماداً حكومياً."
        confirmLabel="حفظ القرار"
        danger={decision === "rejected"}
        busy={busy}
        confirmDisabled={!canConfirm}
        onCancel={() => setOpen(false)}
        onConfirm={submitDecision}
      >
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">القرار</span>
            <select
              value={decision}
              onChange={(event) => setDecision(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="approved">اعتماد (موثّق)</option>
              <option value="needs_information">طلب معلومات إضافية</option>
              <option value="rejected">رفض</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">
              ملاحظات {notesRequired ? "(مطلوبة)" : "(اختيارية)"}
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="سبب القرار أو المعلومات المطلوبة"
            />
          </label>
          {notesRequired && notes.length > 0 && notes.trim().length < 3 && (
            <p className="text-xs text-amber-700">الملاحظات يجب أن تكون 3 أحرف على الأقل.</p>
          )}
          {dialogError && <p className="text-xs text-red-700">{dialogError}</p>}
        </div>
      </ConfirmDialog>
    </div>
  );
}

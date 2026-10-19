"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  AdminPageHeader,
  ErrorPanel,
  LoadingPanel,
  StatusBadge
} from "@/components/admin/ui";
import { PLATFORM_ROLE_LABEL, adminFetch, auditActionLabel, entityLabel, formatDate } from "@/lib/admin";
import { useAdminResource } from "@/lib/useAdminResource";

interface UserDetail {
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    platformRole: string | null;
    organizationId: string | null;
    lastLoginAt: string | null;
    createdAt: string;
    updatedAt: string;
    organization: { id: string; name: string; slug: string } | null;
    memberships: { id: string; role: string; organization: { id: string; name: string } }[];
  };
  ownedCompanies: { id: string; name: string; type: string; status: string; verificationStatus: string }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    outcome: string;
    requestId: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
}

type DialogKind = "role" | "suspend" | "reactivate" | null;

const ROLE_OPTIONS = [
  { value: "SUPER_ADMIN", label: "مدير منصة أعلى" },
  { value: "ADMIN", label: "مدير منصة" },
  { value: "REVIEWER", label: "مراجع تحقق" },
  { value: "SUPPORT", label: "دعم فني" },
  { value: "", label: "بلا دور منصة (إلغاء الوصول)" }
];

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const { user: currentUser, has } = useAdminAuth();
  const { data, loading, error, reload } = useAdminResource<UserDetail>(id ? `/api/v1/admin/users/${id}` : null);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");
  const [nextRole, setNextRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const target = data?.user;
  const isSelf = Boolean(target && currentUser && target.id === currentUser.id);
  const isSuperTarget = target?.platformRole === "SUPER_ADMIN";
  const actorIsSuper = currentUser?.platformRole === "SUPER_ADMIN";
  const canManage = has("users.manage");
  const canAssignRoles = has("users.roles");
  const restrictedSuper = isSuperTarget && !actorIsSuper;

  function openDialog(kind: DialogKind) {
    setDialog(kind);
    setReason("");
    setDialogError(null);
    if (kind === "role") setNextRole(target?.platformRole ?? "");
  }

  async function submitDialog() {
    if (!target || !dialog) return;
    setBusy(true);
    setDialogError(null);
    try {
      if (dialog === "role") {
        await adminFetch(`/api/v1/admin/users/${target.id}/platform-role`, {
          method: "PUT",
          body: JSON.stringify({ role: nextRole || null, reason: reason.trim() })
        });
      } else if (dialog === "suspend") {
        await adminFetch(`/api/v1/admin/users/${target.id}/suspend`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() })
        });
      } else {
        await adminFetch(`/api/v1/admin/users/${target.id}/reactivate`, {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() })
        });
      }
      setDialog(null);
      reload();
    } catch (caught: any) {
      setDialogError(caught?.message ?? "تعذّر تنفيذ الإجراء");
    } finally {
      setBusy(false);
    }
  }

  const reasonValid = reason.trim().length >= 3;
  const roleChanged = (target?.platformRole ?? "") !== nextRole;
  const canConfirm = reasonValid && (dialog !== "role" || roleChanged);

  return (
    <div>
      <AdminPageHeader
        title="تفاصيل المستخدم"
        description="بيانات الحساب والعضويات والنشاط الإداري. أي تغيير في الدور أو الحالة يلغي الجلسات القائمة."
        action={
          <Link href="/admin/users" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
            ← العودة للمستخدمين
          </Link>
        }
      />

      {loading && <LoadingPanel label="جارٍ تحميل بيانات المستخدم..." />}
      {error && !loading && <ErrorPanel message={error} onRetry={reload} />}

      {data && !loading && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-lg font-bold text-teal">
                  {data.user.displayName.charAt(0).toUpperCase()}
                </span>
                <div>
                  <h2 className="text-xl font-bold text-navy">{data.user.displayName}</h2>
                  <p className="ltr-text text-sm text-slate-500">{data.user.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge value={data.user.status} />
                    {data.user.platformRole ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        {PLATFORM_ROLE_LABEL[data.user.platformRole as keyof typeof PLATFORM_ROLE_LABEL] ?? data.user.platformRole}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">بلا دور منصة</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {canAssignRoles && !isSelf && (
                  <button
                    onClick={() => openDialog("role")}
                    disabled={restrictedSuper}
                    title={restrictedSuper ? "تعديل مدير أعلى يتطلب دور مدير منصة أعلى" : undefined}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    تغيير دور المنصة
                  </button>
                )}
                {canManage && !isSelf && data.user.status === "active" && (
                  <button
                    onClick={() => openDialog("suspend")}
                    disabled={restrictedSuper}
                    className="rounded-lg bg-error px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    إيقاف الحساب
                  </button>
                )}
                {canManage && !isSelf && data.user.status === "suspended" && (
                  <button
                    onClick={() => openDialog("reactivate")}
                    disabled={restrictedSuper}
                    className="rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    إعادة التفعيل
                  </button>
                )}
              </div>
            </div>

            {isSelf && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                لا يمكنك تغيير دورك أو إيقاف حسابك بنفسك. هذا يمنع رفع الصلاحيات الذاتي ويمنع فقدان آخر مدير أعلى.
              </p>
            )}
            {restrictedSuper && !isSelf && (
              <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                هذا الحساب مدير منصة أعلى. تعديله متاح فقط لحساب مدير منصة أعلى آخر.
              </p>
            )}

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">المنظمة الأساسية</dt>
                <dd className="mt-1 font-medium text-slate-700">{data.user.organization?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">تاريخ الإنشاء</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.user.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">آخر دخول</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.user.lastLoginAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">آخر تحديث</dt>
                <dd className="mt-1 font-medium text-slate-700">{formatDate(data.user.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">عضويات المنظمة</h3>
                <p className="mt-1 text-xs text-slate-500">أدوار تنظيمية فقط، لا تمنح سلطة على المنصة</p>
              </div>
              {data.user.memberships.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد عضويات مسجلة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.user.memberships.map((membership) => (
                    <li key={membership.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span className="text-slate-600">{membership.organization.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {membership.role}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold text-navy">شركات المنظمة</h3>
                <p className="mt-1 text-xs text-slate-500">الشركات المرتبطة بمنظمة المستخدم الأساسية</p>
              </div>
              {data.ownedCompanies.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">لا توجد شركات مسجلة لهذه المنظمة.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.ownedCompanies.map((company) => (
                    <li key={company.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <Link href={`/admin/companies/${company.id}`} className="font-medium text-slate-700 hover:text-primary">
                        {company.name}
                      </Link>
                      <StatusBadge value={company.verificationStatus} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-panel">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-bold text-navy">آخر نشاط إداري لهذا المستخدم</h3>
              <p className="mt-1 text-xs text-slate-500">أحدث 20 حدثاً في سجل التدقيق</p>
            </div>
            {data.recentActivity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">لا يوجد نشاط مسجل.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-canvas/80">
                    <tr>
                      {["الإجراء", "الكيان", "النتيجة", "معرّف الطلب", "الوقت"].map((header) => (
                        <th key={header} className="px-5 py-3 text-right text-xs font-semibold text-slate-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recentActivity.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-5 py-3 text-slate-700">{auditActionLabel(entry.action)}</td>
                        <td className="px-5 py-3 text-slate-500">{entityLabel(entry.entityType)}</td>
                        <td className="px-5 py-3">
                          <StatusBadge value={entry.outcome} />
                        </td>
                        <td className="ltr-text px-5 py-3 text-[11px] text-slate-400">{entry.requestId ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={dialog === "role"}
        title="تغيير دور المنصة"
        description="سيتم إلغاء جميع جلسات هذا المستخدم فوراً. الدور التنظيمي لا يتغير."
        confirmLabel="حفظ الدور"
        danger
        busy={busy}
        confirmDisabled={!canConfirm}
        onCancel={() => setDialog(null)}
        onConfirm={submitDialog}
      >
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">الدور الجديد</span>
            <select
              value={nextRole}
              onChange={(event) => setNextRole(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">سبب التغيير (مطلوب)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="مثال: نقل موظف إلى فريق الدعم"
            />
          </label>
          {!roleChanged && <p className="text-xs text-amber-700">اختر دوراً مختلفاً عن الدور الحالي.</p>}
          {!reasonValid && reason.length > 0 && <p className="text-xs text-amber-700">السبب يجب أن يكون 3 أحرف على الأقل.</p>}
          {dialogError && <p className="text-xs text-red-700">{dialogError}</p>}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "suspend"}
        title="إيقاف الحساب"
        description="سيُرفض دخول المستخدم وتُلغى جلساته القائمة فوراً. يمكنك إعادة تفعيله لاحقاً."
        confirmLabel="إيقاف الحساب"
        danger
        busy={busy}
        confirmDisabled={!reasonValid}
        onCancel={() => setDialog(null)}
        onConfirm={submitDialog}
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-600">سبب الإيقاف (مطلوب)</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="مثال: مراجعة أمنية"
          />
        </label>
        {dialogError && <p className="mt-2 text-xs text-red-700">{dialogError}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "reactivate"}
        title="إعادة تفعيل الحساب"
        description="سيستطيع المستخدم الدخول من جديد. لن تُستعاد الجلسات القديمة."
        confirmLabel="إعادة التفعيل"
        busy={busy}
        confirmDisabled={!reasonValid}
        onCancel={() => setDialog(null)}
        onConfirm={submitDialog}
      >
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-slate-600">سبب إعادة التفعيل (مطلوب)</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="مثال: اكتملت المراجعة"
          />
        </label>
        {dialogError && <p className="mt-2 text-xs text-red-700">{dialogError}</p>}
      </ConfirmDialog>
    </div>
  );
}

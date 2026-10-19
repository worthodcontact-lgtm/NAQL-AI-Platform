"use client";

import { useState } from "react";
import Link from "next/link";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  AdminPageHeader,
  DataTable,
  Pagination,
  SelectField,
  StatusBadge
} from "@/components/admin/ui";
import { COMPANY_TYPE_LABEL, adminFetch, formatDate } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface PendingCompany {
  id: string;
  name: string;
  type: string;
  country: string | null;
  status: string;
  verificationStatus: string;
  organizationId: string | null;
  createdAt: string;
  _count: { services: number; documents: number; reviews: number };
}

export default function AdminVerificationsPage() {
  const { user, has } = useAdminAuth();
  const list = useAdminList<PendingCompany>("/api/v1/admin/companies", { verificationStatus: "pending" });
  const [status, setStatus] = useState("pending");

  const [target, setTarget] = useState<PendingCompany | null>(null);
  const [decision, setDecision] = useState("approved");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function changeStatus(next: string) {
    setStatus(next);
    list.apply({ verificationStatus: next });
  }

  function openDialog(company: PendingCompany, nextDecision: string) {
    setTarget(company);
    setDecision(nextDecision);
    setNotes("");
    setDialogError(null);
  }

  async function submitDecision() {
    if (!target) return;
    setBusy(true);
    setDialogError(null);
    try {
      await adminFetch(`/api/v1/admin/companies/${target.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, notes: notes.trim() || undefined })
      });
      setTarget(null);
      list.reload();
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
        title="طلبات التحقق"
        description="مراجعة الشركات التي قدمت ملفاتها. كل قرار يتطلب سبباً موثقاً عند الرفض أو طلب معلومات إضافية."
      />

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xs">
          <SelectField
            label="حالة التحقق"
            value={status}
            onChange={changeStatus}
            options={[
              { value: "pending", label: "بانتظار المراجعة" },
              { value: "verified", label: "موثّقة" },
              { value: "rejected", label: "مرفوضة" }
            ]}
          />
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          التحقق قرار مراجعة داخلي من المنصة. لا توجد تكاملات حكومية، ولا يجوز وصف الشركة بأنها «معتمدة حكومياً».
        </p>
      </div>

      <DataTable<PendingCompany>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد طلبات في هذه الحالة"
        emptyDescription="عند تقديم شركة لطلب التحقق ستظهر هنا."
        columns={[
          {
            key: "company",
            header: "الشركة",
            render: (row) => (
              <div>
                <Link href={`/admin/companies/${row.id}`} className="font-semibold text-navy hover:text-primary">
                  {row.name}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {COMPANY_TYPE_LABEL[row.type] ?? row.type} {row.country ? `· ${row.country}` : ""}
                </p>
              </div>
            )
          },
          { key: "verification", header: "التحقق", render: (row) => <StatusBadge value={row.verificationStatus} /> },
          { key: "status", header: "الملف", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "documents",
            header: "الوثائق",
            render: (row) => <span className="text-xs text-slate-500">{row._count.documents} وثيقة</span>
          },
          {
            key: "reviews",
            header: "مراجعات سابقة",
            render: (row) => <span className="text-xs text-slate-500">{row._count.reviews}</span>
          },
          {
            key: "created",
            header: "تاريخ التسجيل",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          },
          {
            key: "actions",
            header: "قرار",
            render: (row) => {
              const own = Boolean(row.organizationId && row.organizationId === user?.organizationId);
              if (!has("companies.verify") || own) {
                return (
                  <Link href={`/admin/companies/${row.id}`} className="text-xs font-semibold text-primary hover:underline">
                    عرض الملف ←
                  </Link>
                );
              }
              return (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => openDialog(row, "approved")}
                    className="rounded-lg bg-success px-2 py-1 text-[11px] font-semibold text-white hover:bg-green-700"
                  >
                    اعتماد
                  </button>
                  <button
                    onClick={() => openDialog(row, "needs_information")}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
                  >
                    معلومات إضافية
                  </button>
                  <button
                    onClick={() => openDialog(row, "rejected")}
                    className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"
                  >
                    رفض
                  </button>
                </div>
              );
            }
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <ConfirmDialog
        open={Boolean(target)}
        title={target ? `قرار تحقق: ${target.name}` : "قرار تحقق"}
        description="سيُسجَّل القرار في تاريخ الشركة وفي سجل التدقيق مع هويتك."
        confirmLabel={decision === "approved" ? "اعتماد الشركة" : decision === "rejected" ? "رفض الملف" : "طلب معلومات"}
        danger={decision === "rejected"}
        busy={busy}
        confirmDisabled={!canConfirm}
        onCancel={() => setTarget(null)}
        onConfirm={submitDecision}
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-canvas p-3 text-xs text-slate-600">
            القرار الحالي: <strong>{decision === "approved" ? "اعتماد" : decision === "rejected" ? "رفض" : "طلب معلومات إضافية"}</strong>
          </p>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">
              ملاحظات {notesRequired ? "(مطلوبة)" : "(اختيارية)"}
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="اذكر سبب القرار أو المستندات المطلوبة"
            />
          </label>
          {dialogError && <p className="text-xs text-red-700">{dialogError}</p>}
          {!canConfirm && <p className="text-xs text-amber-700">أدخل سبباً من 3 أحرف على الأقل للمتابعة.</p>}
        </div>
      </ConfirmDialog>
    </div>
  );
}

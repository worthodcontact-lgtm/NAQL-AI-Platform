"use client";

import { useState } from "react";
import { useAdminAuth } from "@/components/admin/AdminAuthProvider";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  AdminPageHeader,
  DataTable,
  FilterBar,
  Pagination,
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField
} from "@/components/admin/ui";
import { PORT_TYPE_LABEL, adminFetch } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface PortRow {
  id: string;
  code: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  type: string;
  source: string | null;
  verificationStatus: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPortsPage() {
  const { has } = useAdminAuth();
  const list = useAdminList<PortRow>("/api/v1/admin/ports");
  const [draft, setDraft] = useState({ q: "", type: "", verificationStatus: "" });

  const [target, setTarget] = useState<PortRow | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("seaport");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  function openEdit(port: PortRow) {
    setTarget(port);
    setName(port.name);
    setType(port.type);
    setSource(port.source ?? "");
    setDialogError(null);
  }

  async function save() {
    if (!target) return;
    setBusy(true);
    setDialogError(null);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() !== target.name) body.name = name.trim();
      if (type !== target.type) body.type = type;
      if ((source.trim() || null) !== (target.source ?? null)) body.source = source.trim() || null;
      if (Object.keys(body).length === 0) {
        setTarget(null);
        return;
      }
      await adminFetch(`/api/v1/admin/ports/${target.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setTarget(null);
      list.reload();
    } catch (caught: any) {
      setDialogError(caught?.message ?? "تعذّر تحديث الميناء");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="الموانئ"
        description="مرجع الموانئ المستخدم في الشحنات. يمكن تعديل الاسم والنوع والمصدر فقط؛ الإحداثيات غير قابلة للتعديل من الإدارة."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="الاسم أو الرمز أو الدولة" />
        <SelectField
          label="النوع"
          value={draft.type}
          onChange={(type) => setDraft({ ...draft, type })}
          placeholder="كل الأنواع"
          options={Object.entries(PORT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          label="حالة التحقق"
          value={draft.verificationStatus}
          onChange={(verificationStatus) => setDraft({ ...draft, verificationStatus })}
          placeholder="كل الحالات"
          options={[
            { value: "verified", label: "موثّق" },
            { value: "approximate", label: "إحداثيات تقريبية" },
            { value: "unverified", label: "غير موثّق" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<PortRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد موانئ مطابقة"
        emptyDescription="جرّب تعديل البحث أو عوامل التصفية."
        columns={[
          {
            key: "port",
            header: "الميناء",
            render: (row) => (
              <div>
                <p className="font-semibold text-navy">{row.name}</p>
                <p className="ltr-text mt-0.5 text-xs text-slate-500">
                  {row.code} · {row.country}
                </p>
              </div>
            )
          },
          {
            key: "type",
            header: "النوع",
            render: (row) => <span className="text-xs text-slate-600">{PORT_TYPE_LABEL[row.type] ?? row.type}</span>
          },
          {
            key: "coordinates",
            header: "الإحداثيات (ثابتة)",
            render: (row) => (
              <span className="ltr-text text-xs text-slate-500">
                {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
              </span>
            )
          },
          { key: "verification", header: "التحقق", render: (row) => <StatusBadge value={row.verificationStatus} /> },
          {
            key: "source",
            header: "المصدر",
            render: (row) => <span className="text-xs text-slate-500">{row.source ?? "—"}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) =>
              has("ports.manage") ? (
                <button
                  onClick={() => openEdit(row)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-canvas"
                >
                  تعديل
                </button>
              ) : (
                <span className="text-xs text-slate-400">قراءة فقط</span>
              )
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        حالة «إحداثيات تقريبية» تعني أن المرجع غير مؤكد. لا تعرض المنصة الموانئ كبيانات رسمية دون مصدر موثّق.
      </p>

      <ConfirmDialog
        open={Boolean(target)}
        title={target ? `تعديل الميناء: ${target.code}` : "تعديل الميناء"}
        description="سيُسجَّل التغيير في سجل التدقيق مع القيم قبل وبعد. الإحداثيات لا يمكن تغييرها من هنا."
        confirmLabel="حفظ التعديل"
        busy={busy}
        confirmDisabled={name.trim().length < 2}
        onCancel={() => setTarget(null)}
        onConfirm={save}
      >
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">الاسم</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">النوع</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {Object.entries(PORT_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-600">المصدر (اختياري)</span>
            <input
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="مثال: UN/LOCODE"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          {target && (
            <p className="ltr-text rounded-lg bg-canvas p-3 text-xs text-slate-500">
              {target.latitude.toFixed(5)}, {target.longitude.toFixed(5)} — غير قابل للتعديل
            </p>
          )}
          {dialogError && <p className="text-xs text-red-700">{dialogError}</p>}
        </div>
      </ConfirmDialog>
    </div>
  );
}

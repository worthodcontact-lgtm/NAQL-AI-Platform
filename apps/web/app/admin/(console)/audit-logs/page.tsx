"use client";

import { useState } from "react";
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
import { auditActionLabel, entityLabel, formatDate } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  outcome: string;
  requestId: string | null;
  metadata: unknown;
  createdAt: string;
}

function MetadataCell({ metadata }: { metadata: unknown }) {
  if (metadata === null || metadata === undefined) return <span className="text-xs text-slate-400">—</span>;
  const text = typeof metadata === "string" ? metadata : JSON.stringify(metadata);
  if (text === "null" || text === "{}") return <span className="text-xs text-slate-400">—</span>;
  return (
    <details className="max-w-xs">
      <summary className="cursor-pointer text-xs font-semibold text-primary">عرض</summary>
      <pre className="ltr-text mt-1 max-h-40 overflow-auto rounded bg-canvas p-2 text-[10px] leading-relaxed text-slate-600">
        {text}
      </pre>
    </details>
  );
}

export default function AdminAuditLogsPage() {
  const list = useAdminList<AuditRow>("/api/v1/admin/audit-logs");
  const [draft, setDraft] = useState({ action: "", entityType: "", outcome: "", actorUserId: "", from: "", to: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="سجل التدقيق"
        description="سجل إضافي غير قابل للتعديل من واجهة الإدارة. يوثّق الإجراءات الحساسة بهوية المنفّذ والوقت ونتيجة الطلب."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="الإجراء" value={draft.action} onChange={(action) => setDraft({ ...draft, action })} placeholder="مثال: user.suspended" />
        <TextField
          label="نوع الكيان"
          value={draft.entityType}
          onChange={(entityType) => setDraft({ ...draft, entityType })}
          placeholder="User, Company, Port..."
        />
        <SelectField
          label="النتيجة"
          value={draft.outcome}
          onChange={(outcome) => setDraft({ ...draft, outcome })}
          placeholder="كل النتائج"
          options={[
            { value: "success", label: "ناجح" },
            { value: "denied", label: "مرفوض" },
            { value: "failure", label: "فشل" }
          ]}
        />
        <TextField
          label="معرّف المنفّذ"
          value={draft.actorUserId}
          onChange={(actorUserId) => setDraft({ ...draft, actorUserId })}
          placeholder="cuid..."
        />
        <TextField label="من تاريخ" type="date" value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
        <TextField label="إلى تاريخ" type="date" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} />
        <SubmitButton />
      </FilterBar>

      <DataTable<AuditRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد سجلات مطابقة"
        emptyDescription="جرّب توسيع نطاق التاريخ أو إزالة عوامل التصفية."
        columns={[
          {
            key: "action",
            header: "الإجراء",
            render: (row) => (
              <div>
                <p className="font-medium text-slate-700">{auditActionLabel(row.action)}</p>
                <p className="ltr-text mt-0.5 text-[11px] text-slate-400">{row.action}</p>
              </div>
            )
          },
          {
            key: "entity",
            header: "الكيان",
            render: (row) => (
              <div>
                <p className="text-sm text-slate-600">{entityLabel(row.entityType)}</p>
                {row.entityId && <p className="ltr-text mt-0.5 text-[11px] text-slate-400">{row.entityId}</p>}
              </div>
            )
          },
          {
            key: "actor",
            header: "المنفّذ",
            render: (row) => (
              <div>
                <p className="text-xs text-slate-600">{row.actorRole ?? "نظام"}</p>
                {row.actorUserId && <p className="ltr-text mt-0.5 text-[11px] text-slate-400">{row.actorUserId}</p>}
              </div>
            )
          },
          { key: "outcome", header: "النتيجة", render: (row) => <StatusBadge value={row.outcome} /> },
          {
            key: "requestId",
            header: "معرّف الطلب",
            render: (row) => <span className="ltr-text text-[11px] text-slate-400">{row.requestId ?? "—"}</span>
          },
          { key: "metadata", header: "تفاصيل آمنة", render: (row) => <MetadataCell metadata={row.metadata} /> },
          {
            key: "created",
            header: "الوقت",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        تُحذف الحقول الحساسة من التفاصيل قبل التخزين. السجل للقراءة فقط، ولا يمكن لأي دور إداري تعديله أو حذفه من الواجهة.
      </p>
    </div>
  );
}

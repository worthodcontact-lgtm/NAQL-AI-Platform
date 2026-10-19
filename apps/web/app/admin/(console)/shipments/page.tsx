"use client";

import { useState } from "react";
import Link from "next/link";
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
import { formatDate, formatNumber } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface ShipmentRow {
  id: string;
  reference: string;
  mode: string;
  incoterm: string;
  status: string;
  cargoDescription: string | null;
  weightKg: number | null;
  volumeCbm: number | null;
  createdAt: string;
  organization: { id: string; name: string } | null;
  originPort: { id: string; code: string; name: string; country: string } | null;
  destinationPort: { id: string; code: string; name: string; country: string } | null;
}

export default function AdminShipmentsPage() {
  const list = useAdminList<ShipmentRow>("/api/v1/admin/shipments");
  const [draft, setDraft] = useState({ q: "", status: "", mode: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="الشحنات"
        description="عرض تشغيلي للشحنات عبر المنظمات. لا تتضمن هذه الصفحة تعديلاً على بيانات العمليات."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="المرجع أو وصف البضاعة" />
        <SelectField
          label="الحالة"
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          placeholder="كل الحالات"
          options={[
            { value: "DRAFT", label: "مسودة" },
            { value: "IN_TRANSIT", label: "في الطريق" },
            { value: "DELIVERED", label: "تم التسليم" },
            { value: "CANCELLED", label: "ملغاة" }
          ]}
        />
        <SelectField
          label="نمط الشحن"
          value={draft.mode}
          onChange={(mode) => setDraft({ ...draft, mode })}
          placeholder="كل الأنماط"
          options={[
            { value: "sea", label: "بحري" },
            { value: "air", label: "جوي" },
            { value: "land", label: "بري" },
            { value: "multimodal", label: "متعدد الوسائط" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<ShipmentRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد شحنات مطابقة"
        emptyDescription="جرّب تغيير البحث أو الحالة."
        columns={[
          {
            key: "reference",
            header: "المرجع",
            render: (row) => (
              <div>
                <Link href={`/admin/shipments/${row.id}`} className="font-semibold text-navy hover:text-primary">
                  {row.reference}
                </Link>
                <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{row.cargoDescription ?? "بدون وصف"}</p>
              </div>
            )
          },
          {
            key: "organization",
            header: "المنظمة",
            render: (row) => <span className="text-sm text-slate-600">{row.organization?.name ?? "—"}</span>
          },
          {
            key: "route",
            header: "المسار",
            render: (row) => (
              <span className="text-xs text-slate-600">
                {row.originPort ? `${row.originPort.name} (${row.originPort.country})` : "—"}
                <span className="mx-1 text-slate-400">←</span>
                {row.destinationPort ? `${row.destinationPort.name} (${row.destinationPort.country})` : "—"}
              </span>
            )
          },
          {
            key: "mode",
            header: "النمط / الإنكوترم",
            render: (row) => (
              <span className="text-xs text-slate-500">
                {row.mode} · {row.incoterm}
              </span>
            )
          },
          { key: "status", header: "الحالة", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "weight",
            header: "الوزن (كغ)",
            render: (row) => <span className="text-xs text-slate-500">{row.weightKg === null ? "—" : formatNumber(row.weightKg)}</span>
          },
          {
            key: "created",
            header: "تاريخ الإنشاء",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) => (
              <Link href={`/admin/shipments/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                تفاصيل ←
              </Link>
            )
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />
    </div>
  );
}

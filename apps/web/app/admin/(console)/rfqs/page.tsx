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

interface RfqRow {
  id: string;
  organizationId: string;
  organization: { id: string; name: string } | null;
  createdByUserId: string;
  origin: string;
  destination: string;
  mode: string;
  cargoDescription: string;
  weightKg: number | string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { quotes: number; recipients: number; bookings: number };
}

export default function AdminRfqsPage() {
  const list = useAdminList<RfqRow>("/api/v1/admin/rfqs");
  const [draft, setDraft] = useState({ q: "", status: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="طلبات عروض الأسعار"
        description="طلبات العملاء الموزعة على مزودي الخدمة، مع عدد العروض والحجوزات المرتبطة. للقراءة فقط."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="المسار، البضاعة، أو العميل" />
        <SelectField
          label="الحالة"
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          placeholder="كل الحالات"
          options={[
            { value: "submitted", label: "مُقدَّم" },
            { value: "quoted", label: "تم التسعير" },
            { value: "accepted", label: "مقبول" },
            { value: "closed", label: "مغلق" },
            { value: "cancelled", label: "ملغى" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<RfqRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد طلبات مطابقة"
        emptyDescription="جرّب تغيير البحث أو الحالة."
        columns={[
          {
            key: "route",
            header: "الطلب",
            render: (row) => (
              <div>
                <Link href={`/admin/rfqs/${row.id}`} className="font-semibold text-navy hover:text-primary">
                  {row.origin} ← {row.destination}
                </Link>
                <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">{row.cargoDescription}</p>
              </div>
            )
          },
          {
            key: "organization",
            header: "العميل",
            render: (row) => <span className="text-sm text-slate-600">{row.organization?.name ?? "—"}</span>
          },
          {
            key: "mode",
            header: "النمط",
            render: (row) => <span className="text-xs text-slate-600">{row.mode}</span>
          },
          {
            key: "weight",
            header: "الوزن (كغ)",
            render: (row) => <span className="text-xs text-slate-500">{formatNumber(Number(row.weightKg))}</span>
          },
          {
            key: "counts",
            header: "العروض / المدعوون / الحجوزات",
            render: (row) => (
              <span className="text-xs text-slate-500">
                {row._count.quotes} / {row._count.recipients} / {row._count.bookings}
              </span>
            )
          },
          { key: "status", header: "الحالة", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "created",
            header: "تاريخ الإنشاء",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) => (
              <Link href={`/admin/rfqs/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
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

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
import { formatDate, formatMoney } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface QuoteRow {
  id: string;
  rfqId: string;
  companyId: string;
  organizationId: string;
  currency: string;
  totalAmount: number | string;
  transitDays: number;
  validityUntil: string;
  status: string;
  createdAt: string;
  company: { id: string; name: string; type: string; verificationStatus: string } | null;
  rfq: { id: string; origin: string; destination: string; mode: string; status: string } | null;
}

export default function AdminQuotationsPage() {
  const list = useAdminList<QuoteRow>("/api/v1/admin/quotations");
  const [draft, setDraft] = useState({ q: "", status: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="عروض الأسعار"
        description="العروض المقدمة من مزودي الخدمة على طلبات العملاء. القيم كما سجلها المزود ولم تُعدّل من الإدارة."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="المزود أو المسار" />
        <SelectField
          label="الحالة"
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          placeholder="كل الحالات"
          options={[
            { value: "submitted", label: "مُقدَّم" },
            { value: "accepted", label: "مقبول" },
            { value: "rejected", label: "مرفوض" },
            { value: "withdrawn", label: "مسحوب" },
            { value: "expired", label: "منتهي" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<QuoteRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد عروض مطابقة"
        emptyDescription="جرّب تغيير البحث أو الحالة."
        columns={[
          {
            key: "company",
            header: "المزود",
            render: (row) => (
              <div>
                <Link href={`/admin/quotations/${row.id}`} className="font-semibold text-navy hover:text-primary">
                  {row.company?.name ?? "—"}
                </Link>
                {row.company && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.company.type} · <StatusBadge value={row.company.verificationStatus} />
                  </p>
                )}
              </div>
            )
          },
          {
            key: "rfq",
            header: "المسار",
            render: (row) =>
              row.rfq ? (
                <span className="text-xs text-slate-600">
                  {row.rfq.origin} ← {row.rfq.destination}
                  <span className="mr-1 text-slate-400">({row.rfq.mode})</span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          {
            key: "amount",
            header: "الإجمالي",
            render: (row) => (
              <span className="whitespace-nowrap font-medium text-slate-700">{formatMoney(row.totalAmount, row.currency)}</span>
            )
          },
          {
            key: "transit",
            header: "مدة العبور",
            render: (row) => <span className="text-xs text-slate-600">{row.transitDays} يوم</span>
          },
          {
            key: "validity",
            header: "صالح حتى",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.validityUntil)}</span>
          },
          { key: "status", header: "الحالة", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "created",
            header: "تاريخ التقديم",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) => (
              <Link href={`/admin/quotations/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
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

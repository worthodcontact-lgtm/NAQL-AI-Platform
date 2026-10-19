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
import { COMPANY_TYPE_LABEL, formatDate } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface CompanyRow {
  id: string;
  name: string;
  type: string;
  status: string;
  verificationStatus: string;
  country: string | null;
  email: string | null;
  listed: boolean;
  createdAt: string;
  _count: { services: number; documents: number; reviews: number };
}

export default function AdminCompaniesPage() {
  const list = useAdminList<CompanyRow>("/api/v1/admin/companies");
  const [draft, setDraft] = useState({ q: "", verificationStatus: "", type: "", status: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="دليل الشركات"
        description="كل الشركات المسجلة على المنصة. التحقق هنا هو قرار مراجعة داخلي وليس اعتماداً حكومياً."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="اسم الشركة أو الدولة" />
        <SelectField
          label="حالة التحقق"
          value={draft.verificationStatus}
          onChange={(verificationStatus) => setDraft({ ...draft, verificationStatus })}
          placeholder="كل الحالات"
          options={[
            { value: "unregistered", label: "غير مسجّل" },
            { value: "pending", label: "قيد التحقق" },
            { value: "verified", label: "موثّق" },
            { value: "rejected", label: "مرفوض" }
          ]}
        />
        <SelectField
          label="نوع الشركة"
          value={draft.type}
          onChange={(type) => setDraft({ ...draft, type })}
          placeholder="كل الأنواع"
          options={Object.entries(COMPANY_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<CompanyRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد شركات مطابقة"
        emptyDescription="جرّب تغيير البحث أو حالة التحقق."
        columns={[
          {
            key: "name",
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
          { key: "status", header: "حالة الملف", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "listed",
            header: "الدليل العام",
            render: (row) => (
              <span className={`text-xs font-semibold ${row.listed ? "text-green-700" : "text-slate-400"}`}>
                {row.listed ? "مُدرج" : "غير مُدرج"}
              </span>
            )
          },
          {
            key: "counts",
            header: "الخدمات / الوثائق / المراجعات",
            render: (row) => (
              <span className="text-xs text-slate-500">
                {row._count.services} / {row._count.documents} / {row._count.reviews}
              </span>
            )
          },
          {
            key: "created",
            header: "تاريخ التسجيل",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.createdAt)}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) => (
              <Link href={`/admin/companies/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                تفاصيل ←
              </Link>
            )
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        لا يتم عرض مفاتيح التخزين الداخلية للوثائق. قرار «موثّق» يعني اجتياز مراجعة المنصة، ولا يمثل شهادة من جهة حكومية.
      </p>
    </div>
  );
}

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

interface BookingRow {
  id: string;
  status: string;
  organizationId: string;
  organization: { id: string; name: string } | null;
  createdByUserId: string;
  confirmedAt: string | null;
  externalReference: string | null;
  rejectionReason: string | null;
  createdAt: string;
  rfq: { id: string; origin: string; destination: string; mode: string; status: string } | null;
  quote: {
    id: string;
    currency: string;
    totalAmount: number | string;
    transitDays: number;
    validityUntil: string;
    status: string;
    company: { id: string; name: string; verificationStatus: string } | null;
  } | null;
}

export default function AdminBookingsPage() {
  const list = useAdminList<BookingRow>("/api/v1/admin/bookings");
  const [draft, setDraft] = useState({ q: "", status: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="الحجوزات"
        description="متابعة طلبات الحجز بين العملاء ومزودي الخدمة. هذه الشاشة للقراءة فقط؛ قرار التأكيد يبقى لمزود الخدمة."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="المرجع، المسار، العميل، أو المزود" />
        <SelectField
          label="الحالة"
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          placeholder="كل الحالات"
          options={[
            { value: "requested", label: "مطلوب" },
            { value: "confirmed", label: "مؤكد" },
            { value: "rejected", label: "مرفوض" },
            { value: "cancelled", label: "ملغى" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<BookingRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا توجد حجوزات مطابقة"
        emptyDescription="جرّب تغيير البحث أو الحالة."
        columns={[
          {
            key: "booking",
            header: "الحجز",
            render: (row) => (
              <div>
                <Link href={`/admin/bookings/${row.id}`} className="ltr-text font-semibold text-navy hover:text-primary">
                  {row.id.slice(0, 12)}…
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">{formatDate(row.createdAt)}</p>
              </div>
            )
          },
          {
            key: "organization",
            header: "العميل",
            render: (row) => <span className="text-sm text-slate-600">{row.organization?.name ?? "—"}</span>
          },
          {
            key: "route",
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
            key: "provider",
            header: "مزود الخدمة",
            render: (row) => <span className="text-sm text-slate-600">{row.quote?.company?.name ?? "—"}</span>
          },
          {
            key: "amount",
            header: "المبلغ",
            render: (row) =>
              row.quote ? (
                <span className="whitespace-nowrap text-sm font-medium text-slate-700">
                  {formatMoney(row.quote.totalAmount, row.quote.currency)}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          { key: "status", header: "الحالة", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "confirmed",
            header: "المرجع الخارجي",
            render: (row) => <span className="ltr-text text-xs text-slate-500">{row.externalReference ?? "—"}</span>
          },
          {
            key: "actions",
            header: "",
            render: (row) => (
              <Link href={`/admin/bookings/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                تفاصيل ←
              </Link>
            )
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        تأكيد الحجز أو رفضه يتم عبر مزود الخدمة صاحب العرض المقبول. المنصة تسجل القرار ولا تنشئ حجزاً نيابة عن الأطراف.
      </p>
    </div>
  );
}

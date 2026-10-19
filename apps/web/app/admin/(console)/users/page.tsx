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
  TextField,
  statusLabel
} from "@/components/admin/ui";
import { PLATFORM_ROLE_LABEL, formatDate } from "@/lib/admin";
import { useAdminList } from "@/lib/useAdminResource";

interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  status: string;
  platformRole: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  organization: { id: string; name: string } | null;
  memberships: { id: string; role: string; organization: { id: string; name: string } }[];
}

export default function AdminUsersPage() {
  const list = useAdminList<AdminUserRow>("/api/v1/admin/users");
  const [draft, setDraft] = useState({ q: "", status: "", platformRole: "" });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    list.apply(draft);
  }

  return (
    <div>
      <AdminPageHeader
        title="المستخدمون"
        description="بحث وتصفية الحسابات، فحص العضويات، إيقاف الحساب أو إعادة تفعيله، وتعيين أدوار المنصة. أدوار المنظمة تبقى منفصلة عن سلطة المنصة."
      />

      <FilterBar onSubmit={submit}>
        <TextField label="بحث" value={draft.q} onChange={(q) => setDraft({ ...draft, q })} placeholder="الاسم، البريد، أو المنظمة" />
        <SelectField
          label="الحالة"
          value={draft.status}
          onChange={(status) => setDraft({ ...draft, status })}
          placeholder="كل الحالات"
          options={[
            { value: "active", label: "نشط" },
            { value: "suspended", label: "موقوف" }
          ]}
        />
        <SelectField
          label="دور المنصة"
          value={draft.platformRole}
          onChange={(platformRole) => setDraft({ ...draft, platformRole })}
          placeholder="كل الأدوار"
          options={[
            { value: "SUPER_ADMIN", label: "مدير منصة أعلى" },
            { value: "ADMIN", label: "مدير منصة" },
            { value: "REVIEWER", label: "مراجع تحقق" },
            { value: "SUPPORT", label: "دعم فني" },
            { value: "none", label: "بلا دور منصة" }
          ]}
        />
        <SubmitButton />
      </FilterBar>

      <DataTable<AdminUserRow>
        rows={list.items}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        emptyTitle="لا يوجد مستخدمون مطابقون"
        emptyDescription="جرّب تعديل البحث أو عوامل التصفية."
        columns={[
          {
            key: "user",
            header: "المستخدم",
            render: (row) => (
              <div>
                <Link href={`/admin/users/${row.id}`} className="font-semibold text-navy hover:text-primary">
                  {row.displayName}
                </Link>
                <p className="ltr-text mt-0.5 text-xs text-slate-500">{row.email}</p>
              </div>
            )
          },
          {
            key: "org",
            header: "المنظمة",
            render: (row) => <span className="text-sm text-slate-600">{row.organization?.name ?? "—"}</span>
          },
          {
            key: "roles",
            header: "أدوار المنظمة",
            render: (row) =>
              row.memberships.length ? (
                <div className="flex flex-wrap gap-1">
                  {row.memberships.slice(0, 4).map((membership) => (
                    <span key={membership.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                      {membership.role}
                    </span>
                  ))}
                  {row.memberships.length > 4 && <span className="text-[11px] text-slate-400">+{row.memberships.length - 4}</span>}
                </div>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          {
            key: "platformRole",
            header: "دور المنصة",
            render: (row) =>
              row.platformRole ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {PLATFORM_ROLE_LABEL[row.platformRole as keyof typeof PLATFORM_ROLE_LABEL] ?? row.platformRole}
                </span>
              ) : (
                <span className="text-xs text-slate-400">بلا دور</span>
              )
          },
          { key: "status", header: "الحالة", render: (row) => <StatusBadge value={row.status} /> },
          {
            key: "lastLogin",
            header: "آخر دخول",
            render: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(row.lastLoginAt)}</span>
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
              <Link href={`/admin/users/${row.id}`} className="whitespace-nowrap text-xs font-semibold text-primary hover:underline">
                تفاصيل ←
              </Link>
            )
          }
        ]}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} />

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        {statusLabel("active")}: الحساب يستطيع الدخول. {statusLabel("suspended")}: يُرفض الدخول وتُلغى الجلسات القائمة فوراً.
        لا تُعرض كلمات المرور أو إصدارات الجلسات في أي استجابة.
      </p>
    </div>
  );
}

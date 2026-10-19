"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/EmptyState";

export function AdminPageHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

type Tone = "success" | "warning" | "error" | "info" | "neutral";

const STATUS_LABEL: Record<string, string> = {
  active: "نشط",
  suspended: "موقوف",
  draft: "مسودة",
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
  needs_information: "يحتاج معلومات",
  unregistered: "غير مسجّل",
  verified: "موثّق",
  approximate: "إحداثيات تقريبية",
  unverified: "غير موثّق",
  requested: "مطلوب",
  confirmed: "مؤكد",
  cancelled: "ملغى",
  submitted: "مُقدَّم",
  quoted: "تم التسعير",
  accepted: "مقبول",
  withdrawn: "مسحوب",
  closed: "مغلق",
  open: "مفتوح",
  DRAFT: "مسودة",
  IN_TRANSIT: "في الطريق",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغاة",
  success: "ناجح",
  denied: "مرفوض",
  failure: "فشل"
};

const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  verified: "success",
  approved: "success",
  confirmed: "success",
  accepted: "success",
  DELIVERED: "success",
  success: "success",
  pending: "warning",
  needs_information: "warning",
  requested: "warning",
  submitted: "info",
  quoted: "info",
  IN_TRANSIT: "info",
  open: "info",
  approximate: "warning",
  suspended: "error",
  rejected: "error",
  cancelled: "error",
  CANCELLED: "error",
  denied: "error",
  failure: "error"
};

export function statusLabel(value?: string | null): string {
  if (!value) return "—";
  return STATUS_LABEL[value] ?? value;
}

export function statusTone(value?: string | null): Tone {
  if (!value) return "neutral";
  return STATUS_TONE[value] ?? "neutral";
}

export function StatusBadge({ value, label }: { value?: string | null; label?: string }) {
  return <Badge variant={statusTone(value)}>{label ?? statusLabel(value)}</Badge>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  href
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const tones: Record<Tone, string> = {
    success: "border-green-200 bg-green-50/60",
    warning: "border-amber-200 bg-amber-50/60",
    error: "border-red-200 bg-red-50/60",
    info: "border-blue-200 bg-blue-50/60",
    neutral: "border-slate-200 bg-white"
  };
  const body = (
    <div className={`rounded-2xl border p-4 shadow-panel transition ${tones[tone]} ${href ? "hover:border-primary/50" : ""}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-navy">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <p className="text-sm font-semibold text-red-800">تعذّر تحميل البيانات</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function LoadingPanel({ label = "جارٍ تحميل البيانات..." }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="mb-4 text-sm text-slate-500">{label}</p>
      <div className="space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-4/5" />
      </div>
    </div>
  );
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <p className="text-base font-semibold text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  emptyTitle = "لا توجد نتائج",
  emptyDescription = "جرّب تغيير عوامل التصفية أو البحث."
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (loading) return <LoadingPanel />;
  if (error) return <ErrorPanel message={error} onRetry={onRetry} />;
  if (rows.length === 0) return <EmptyPanel title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-canvas/80">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`whitespace-nowrap px-4 py-3 text-right text-xs font-semibold text-slate-500 ${column.className ?? ""}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={row.id ?? index} className="hover:bg-canvas/60">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 align-top text-slate-700 ${column.className ?? ""}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-slate-500 sm:flex-row">
      <p>
        عرض {from.toLocaleString("ar-EG")}–{to.toLocaleString("ar-EG")} من {total.toLocaleString("ar-EG")}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
        >
          السابق
        </button>
        <span className="text-xs">
          صفحة {page.toLocaleString("ar-EG")} / {pages.toLocaleString("ar-EG")}
        </span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-40"
        >
          التالي
        </button>
      </div>
    </div>
  );
}

export function FilterBar({ children, onSubmit }: { children: React.ReactNode; onSubmit: (event: React.FormEvent) => void }) {
  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:grid-cols-2 lg:grid-cols-4"
    >
      {children}
    </form>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

export function SubmitButton({ children = "تطبيق" }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-end">
      <button
        type="submit"
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        {children}
      </button>
    </div>
  );
}

export function MiniBars({ items, emptyLabel = "لا توجد بيانات" }: { items: { label: string; value: number }[]; emptyLabel?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.length === 0) return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
            <span>{item.label}</span>
            <span className="font-semibold text-slate-700">{item.value.toLocaleString("ar-EG")}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(4, Math.round((item.value / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

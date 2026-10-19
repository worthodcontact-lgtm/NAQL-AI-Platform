"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TradeRow {
  code: string;
  name: string | null;
  value: number;
  share: number | null;
}

interface TradeOverview {
  reporter: { code: number; name: string | null };
  year: number;
  flow: "M" | "X";
  flowLabel: string | null;
  totals: {
    imports: { value: number | null; basis: string };
    exports: { value: number | null; basis: string };
    balance: { value: number | null; basis: string };
  };
  topPartners: TradeRow[];
  topCommodities: TradeRow[];
  series: { year: number; value: number }[];
  partial: boolean;
  unavailable: string[];
  provenance: {
    source: string;
    upstream: string;
    dataset: string;
    fetchedAt: string;
    cached: boolean;
    note: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Reference data (public UN M49 reporter codes)                              */
/* -------------------------------------------------------------------------- */

const REPORTERS = [
  { code: "818", label: "مصر" },
  { code: "682", label: "السعودية" },
  { code: "784", label: "الإمارات" },
  { code: "792", label: "تركيا" },
  { code: "356", label: "الهند" },
  { code: "156", label: "الصين" },
  { code: "842", label: "الولايات المتحدة" },
  { code: "276", label: "ألمانيا" }
];

const PART_LABEL: Record<string, string> = {
  imports: "الواردات",
  exports: "الصادرات",
  partners: "الشركاء",
  commodities: "السلع",
  series: "السلسلة الزمنية"
};

const lastCompleteYear = new Date().getFullYear() - 1;
const YEARS = Array.from({ length: 12 }, (_, index) => lastCompleteYear - index);

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

const fullNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2
});

function money(value: number | null) {
  return value === null ? "—" : `$${fullNumber.format(value)}`;
}

function shortMoney(value: number | null) {
  return value === null ? "—" : `$${compactNumber.format(value)}`;
}

function percent(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function errorTitle(code?: string) {
  switch (code) {
    case "not_configured":
      return "مزوّد بيانات التجارة غير مُهيّأ";
    case "rate_limited":
      return "تم بلوغ حد الطلبات لدى المزوّد";
    case "timeout":
      return "انتهت مهلة الاتصال بالمزوّد";
    case "unauthorized":
      return "رفض المزوّد مفتاح الاشتراك";
    default:
      return "تعذر تحميل بيانات التجارة";
  }
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * External trade statistics.
 *
 * Every number on this page comes from UN Comtrade at request time (or from the
 * server-side 30-minute cache) and carries its source and fetch timestamp. When the
 * provider is unavailable the page shows an explicit error instead of stale or
 * invented figures.
 */
export default function TradePage() {
  const [reporter, setReporter] = useState("818");
  const [year, setYear] = useState(lastCompleteYear);
  const [flow, setFlow] = useState<"M" | "X">("M");

  const [data, setData] = useState<TradeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code?: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch(
        `/api/v1/trade/overview?reporter=${reporter}&year=${year}&flow=${flow}&limit=10`
      );
      setData(result as TradeOverview);
    } catch (err) {
      setData(null);
      if (err instanceof ApiError) {
        setError({ message: err.message, code: err.code, status: err.status });
      } else {
        setError({ message: "تعذر الاتصال بالخادم." });
      }
    } finally {
      setLoading(false);
    }
  }, [reporter, year, flow]);

  useEffect(() => {
    load();
  }, [load]);

  const seriesMax = useMemo(() => {
    if (!data) return 0;
    return data.series.reduce((max, point) => Math.max(max, point.value), 0);
  }, [data]);

  const reporterLabel = REPORTERS.find((item) => item.code === reporter)?.label ?? data?.reporter.name ?? reporter;
  const flowLabel = flow === "M" ? "الواردات" : "الصادرات";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy">التجارة الخارجية</h1>
        <p className="mt-1 text-sm text-slate-500">
          إحصاءات تجارة مجمّعة سنويًا من قاعدة الأمم المتحدة UN Comtrade، مع توضيح المصدر وتاريخ الجلب.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <div className="grid gap-4 p-5 md:grid-cols-[1fr_160px_auto] md:items-end">
          <div className="space-y-1">
            <label htmlFor="trade-reporter" className="block text-sm font-medium text-slate-600">
              الدولة المُبلِّغة
            </label>
            <select
              id="trade-reporter"
              value={reporter}
              onChange={(event) => setReporter(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {REPORTERS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="trade-year" className="block text-sm font-medium text-slate-600">
              السنة
            </label>
            <select
              id="trade-year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {YEARS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <Button
              variant={flow === "M" ? "primary" : "secondary"}
              onClick={() => setFlow("M")}
              aria-pressed={flow === "M"}
            >
              واردات
            </Button>
            <Button
              variant={flow === "X" ? "primary" : "secondary"}
              onClick={() => setFlow("X")}
              aria-pressed={flow === "X"}
            >
              صادرات
            </Button>
          </div>
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <div className="space-y-2 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-red-800">{errorTitle(error.code)}</p>
              {error.status && <Badge variant="error">HTTP {error.status}</Badge>}
            </div>
            <p className="text-sm text-red-700">{error.message}</p>
            {error.code === "not_configured" && (
              <p className="text-sm text-red-700">
                أضف <code className="ltr-text font-mono">COMTRADE_API_KEY</code> إلى ملف{" "}
                <code className="ltr-text font-mono">.env</code> في جذر المشروع، ثم أعد تشغيل الـ API.
              </p>
            )}
            <Button variant="secondary" onClick={load}>
              إعادة المحاولة
            </Button>
          </div>
        </Card>
      )}

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {!loading && data && (
        <>
          {data.partial && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              بعض الأجزاء تعذّر جلبها من المزوّد:{" "}
              {data.unavailable.map((part) => PART_LABEL[part] ?? part).join("، ")}. الأرقام المعروضة لا تشملها.
            </div>
          )}

          {/* Totals */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <div className="p-5">
                <p className="text-sm text-slate-500">إجمالي الواردات {year}</p>
                <p className="mt-2 text-2xl font-bold text-navy" title={money(data.totals.imports.value)}>
                  {shortMoney(data.totals.imports.value)}
                </p>
                <p className="mt-1 text-xs text-slate-400">قيمة CIF — تشمل التأمين والشحن</p>
              </div>
            </Card>

            <Card>
              <div className="p-5">
                <p className="text-sm text-slate-500">إجمالي الصادرات {year}</p>
                <p className="mt-2 text-2xl font-bold text-navy" title={money(data.totals.exports.value)}>
                  {shortMoney(data.totals.exports.value)}
                </p>
                <p className="mt-1 text-xs text-slate-400">قيمة FOB — قبل الشحن والتأمين</p>
              </div>
            </Card>

            <Card>
              <div className="p-5">
                <p className="text-sm text-slate-500">الميزان التجاري</p>
                <p
                  className={`mt-2 text-2xl font-bold ${
                    data.totals.balance.value !== null && data.totals.balance.value < 0
                      ? "text-error"
                      : "text-navy"
                  }`}
                  title={money(data.totals.balance.value)}
                >
                  {shortMoney(data.totals.balance.value)}
                </p>
                <p className="mt-1 text-xs text-slate-400">الواردات ناقص الصادرات</p>
              </div>
            </Card>
          </div>

          {/* Rankings */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={`أكبر 10 شركاء تجاريين — ${flowLabel} ${year}`}
                subtitle={`النسبة من إجمالي ${flowLabel} البالغ ${shortMoney(
                  flow === "M" ? data.totals.imports.value : data.totals.exports.value
                )}`}
              />
              <div className="p-5">
                {data.topPartners.length === 0 ? (
                  <p className="text-sm text-slate-500">لا توجد صفوف شركاء في هذه السنة.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.topPartners.map((row) => (
                      <li key={row.code}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-700">
                            {row.name ?? `كود ${row.code}`}
                          </span>
                          <span className="ltr-text text-slate-500">{money(row.value)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-teal"
                              style={{ width: `${Math.min(100, row.share ?? 0)}%` }}
                            />
                          </div>
                          <span className="w-12 text-left text-xs text-slate-400">{percent(row.share)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`أكبر 10 فصول HS — ${flowLabel} ${year}`}
                subtitle="تصنيف HS المراجعة السادسة، على مستوى الفصل (رقمين)"
              />
              <div className="p-5">
                {data.topCommodities.length === 0 ? (
                  <p className="text-sm text-slate-500">لا توجد صفوف سلع في هذه السنة.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.topCommodities.map((row) => (
                      <li key={row.code}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-700">
                            <span className="ltr-text font-mono text-slate-500">{row.code}</span>{" "}
                            {row.name ?? "بدون وصف"}
                          </span>
                          <span className="ltr-text text-slate-500">{money(row.value)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{ width: `${Math.min(100, row.share ?? 0)}%` }}
                            />
                          </div>
                          <span className="w-12 text-left text-xs text-slate-400">{percent(row.share)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          {/* Series */}
          <Card>
            <CardHeader
              title={`تطور ${flowLabel} — آخر 5 سنوات`}
              subtitle={`${data.reporter.name ?? reporterLabel} · حتى ${year}`}
            />
            <div className="p-5">
              {data.series.length === 0 ? (
                <p className="text-sm text-slate-500">لا توجد سلسلة زمنية متاحة لهذه الفترة.</p>
              ) : (
                <div className="flex h-48 items-end gap-4">
                  {data.series.map((point) => (
                    <div key={point.year} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <span className="ltr-text text-xs text-slate-500">{shortMoney(point.value)}</span>
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t-lg bg-primary/80"
                          style={{
                            height: seriesMax > 0 ? `${Math.max(2, (point.value / seriesMax) * 100)}%` : "2px"
                          }}
                          title={money(point.value)}
                        />
                      </div>
                      <span className="ltr-text text-xs font-semibold text-slate-600">{point.year}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Provenance */}
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{data.provenance.source}</Badge>
              <span className="ltr-text">{data.provenance.upstream}</span>
              {data.provenance.cached && <Badge variant="neutral">من الذاكرة المؤقتة</Badge>}
              {data.partial && <Badge variant="warning">بيانات جزئية</Badge>}
            </div>
            <p className="mt-2">{data.provenance.dataset}</p>
            <p className="mt-1">
              تاريخ الجلب: <span className="ltr-text">{formatTimestamp(data.provenance.fetchedAt)}</span>
            </p>
            <p className="mt-1 leading-relaxed">{data.provenance.note}</p>
          </div>
        </>
      )}

      {!loading && !data && !error && (
        <p className="text-sm text-slate-500">لا توجد بيانات لعرضها.</p>
      )}
    </div>
  );
}

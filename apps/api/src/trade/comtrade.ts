import { env } from "../config/env.js";

/**
 * UN Comtrade client.
 *
 * Only this module knows about the subscription keys. They are sent as a request
 * header, never as a query parameter, and never leave the server process.
 *
 * Behaviour that matters for honesty:
 *  - A missing key is a configuration error, not an empty dataset.
 *  - An upstream failure is an error, never a fabricated row.
 *  - Successful responses are cached briefly so the free-tier quota is not burned by
 *    page refreshes.
 */

export type TradeErrorCode =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "invalid_response";

export class TradeError extends Error {
  code: TradeErrorCode;
  status: number;
  retryAfterSeconds?: number;

  constructor(code: TradeErrorCode, message: string, status = 502, retryAfterSeconds?: number) {
    super(message);
    this.name = "TradeError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type ComtradeParams = Record<string, string>;

export interface ComtradeResponse {
  data: any[];
  [key: string]: unknown;
}

export interface ComtradeResult {
  response: ComtradeResponse;
  cached: boolean;
  fetchedAt: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 64;

interface CacheEntry {
  expiresAt: number;
  fetchedAt: string;
  response: ComtradeResponse;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ComtradeResult>>();

/** Test helper. Never called by production code. */
export function clearTradeCache(): void {
  cache.clear();
  inFlight.clear();
}

export function comtradeConfigured(): boolean {
  return subscriptionKeys().length > 0;
}

function subscriptionKeys(): string[] {
  return [env.COMTRADE_API_KEY, env.COMTRADE_API_KEY_SECONDARY]
    .map((key) => (key ?? "").trim())
    .filter((key) => key.length > 0);
}

function baseUrl(): string {
  return (env.COMTRADE_API_BASE_URL || "https://comtradeapi.un.org").replace(/\/+$/, "");
}

function timeoutMs(): number {
  const parsed = Number(env.COMTRADE_REQUEST_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12000;
}

/**
 * Build the query string without encoding commas. Comtrade accepts `%2C`, but the
 * multi-period form is verified in its literal form, so we keep it that way.
 */
function queryString(params: ComtradeParams): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value)).replace(/%2C/g, ",")}`)
    .join("&");
}

async function fetchOnce(params: ComtradeParams, key: string): Promise<ComtradeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const url = `${baseUrl()}/data/v1/get/C/A/HS?${queryString(params)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Ocp-Apim-Subscription-Key": key
      },
      signal: controller.signal
    });

    if (res.status === 401 || res.status === 403) {
      throw new TradeError("unauthorized", "Comtrade rejected the subscription key.", 502);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new TradeError(
        "rate_limited",
        "Comtrade rate limit reached. Try again later.",
        503,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      );
    }

    if (!res.ok) {
      throw new TradeError("upstream_error", `Comtrade returned HTTP ${res.status}.`, 502);
    }

    const json = (await res.json()) as ComtradeResponse;
    if (!json || !Array.isArray(json.data)) {
      throw new TradeError("invalid_response", "Comtrade response did not contain a data array.", 502);
    }

    return json;
  } catch (error) {
    if (error instanceof TradeError) throw error;
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new TradeError("timeout", "Comtrade did not respond in time.", 504);
    }
    throw new TradeError("upstream_error", "Could not reach Comtrade.", 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function comtradeGet(params: ComtradeParams): Promise<ComtradeResult> {
  const keys = subscriptionKeys();
  if (keys.length === 0) {
    throw new TradeError(
      "not_configured",
      "Trade data provider is not configured (COMTRADE_API_KEY is missing).",
      503
    );
  }

  const cacheKey = queryString(params);

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return { response: hit.response, cached: true, fetchedAt: hit.fetchedAt };
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const task = (async (): Promise<ComtradeResult> => {
    let lastError: unknown;

    for (const key of keys) {
      try {
        const response = await fetchOnce(params, key);
        const fetchedAt = new Date().toISOString();
        cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt, response });

        // Bound the cache so a long-running process cannot grow without limit.
        while (cache.size > CACHE_MAX_ENTRIES) {
          const oldest = cache.keys().next().value as string | undefined;
          if (!oldest) break;
          cache.delete(oldest);
        }

        return { response, cached: false, fetchedAt };
      } catch (error) {
        lastError = error;
        // Only a rejected key justifies trying the secondary one.
        if (!(error instanceof TradeError) || error.code !== "unauthorized") break;
      }
    }

    throw lastError instanceof TradeError
      ? lastError
      : new TradeError("upstream_error", "Comtrade request failed.", 502);
  })();

  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/* -------------------------------------------------------------------------- */
/* Overview assembly                                                          */
/* -------------------------------------------------------------------------- */

export interface TradeOverviewInput {
  reporter: string;
  year: number;
  flow: "M" | "X";
  limit: number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function yearRange(endYear: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => endYear - (count - 1) + index);
}

function firstRow(response: ComtradeResponse | null): any | null {
  if (!response || response.data.length === 0) return null;
  return response.data[0];
}

function rankRows(
  rows: any[],
  codeField: "partnerCode" | "cmdCode",
  nameField: "partnerDesc" | "cmdDesc",
  total: number | null,
  limit: number
) {
  return rows
    .map((row) => ({
      code: row?.[codeField] != null ? String(row[codeField]) : "",
      name: typeof row?.[nameField] === "string" ? (row[nameField] as string) : null,
      value: toNumber(row?.primaryValue) ?? 0
    }))
    // "0" is the World aggregate, not a partner or a chapter.
    .filter((row) => row.code !== "" && row.code !== "0" && row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row) => ({
      ...row,
      share: total && total > 0 ? Math.round((row.value / total) * 1000) / 10 : null
    }));
}

function buildSeries(rows: any[]) {
  return rows
    .map((row) => ({ year: toNumber(row?.period), value: toNumber(row?.primaryValue) }))
    .filter((row): row is { year: number; value: number } => row.year !== null && row.value !== null)
    .sort((a, b) => a.year - b.year);
}

export interface TradeOverview {
  reporter: { code: number; name: string | null };
  year: number;
  flow: "M" | "X";
  flowLabel: string | null;
  totals: {
    imports: { value: number | null; basis: "CIF" };
    exports: { value: number | null; basis: "FOB" };
    balance: { value: number | null; basis: "imports - exports" };
  };
  topPartners: ReturnType<typeof rankRows>;
  topCommodities: ReturnType<typeof rankRows>;
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

export async function getTradeOverview(input: TradeOverviewInput): Promise<TradeOverview> {
  const { reporter, year, flow, limit } = input;

  const common: ComtradeParams = {
    reporterCode: reporter,
    partnerCode: "0",
    includeDesc: "true"
  };

  // Comtrade's free tier rejects bursts: fire the calls sequentially, with a small
  // gap, instead of five concurrent requests. Reliability beats a few hundred ms.
  const requests: Array<() => Promise<ComtradeResult>> = [
    () => comtradeGet({ ...common, period: String(year), cmdCode: "TOTAL", flowCode: "M" }),
    () => comtradeGet({ ...common, period: String(year), cmdCode: "TOTAL", flowCode: "X" }),
    () => comtradeGet({ ...common, partnerCode: "", period: String(year), cmdCode: "TOTAL", flowCode: flow }),
    () => comtradeGet({ ...common, period: String(year), cmdCode: "AG2", flowCode: flow }),
    () =>
      comtradeGet({
        ...common,
        period: yearRange(year, 5).join(","),
        cmdCode: "TOTAL",
        flowCode: flow
      })
  ];

  const labels = ["imports", "exports", "partners", "commodities", "series"] as const;

  const settled: PromiseSettledResult<ComtradeResult>[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    try {
      settled.push({ status: "fulfilled", value: await requests[index]() });
    } catch (reason) {
      settled.push({ status: "rejected", reason } as PromiseRejectedResult);
    }
    if (index < requests.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  const unavailable = settled
    .map((result, index) => (result.status === "rejected" ? labels[index] : null))
    .filter((label): label is (typeof labels)[number] => label !== null);

  // If every upstream call failed there is nothing honest to return.
  if (unavailable.length === settled.length) {
    const first = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    throw first.reason;
  }

  const fulfilled = (index: number): ComtradeResult | null =>
    settled[index].status === "fulfilled" ? (settled[index] as PromiseFulfilledResult<ComtradeResult>).value : null;

  const importsResult = fulfilled(0);
  const exportsResult = fulfilled(1);
  const partnersResult = fulfilled(2);
  const commoditiesResult = fulfilled(3);
  const seriesResult = fulfilled(4);

  const importsRow = firstRow(importsResult?.response ?? null);
  const exportsRow = firstRow(exportsResult?.response ?? null);

  const importValue = toNumber(importsRow?.cifvalue ?? importsRow?.primaryValue);
  const exportValue = toNumber(exportsRow?.fobvalue ?? exportsRow?.primaryValue);
  const balance = importValue !== null && exportValue !== null ? importValue - exportValue : null;

  const flowValue = flow === "M" ? importValue : exportValue;

  const fetchedAt =
    [importsResult, exportsResult, partnersResult, commoditiesResult, seriesResult]
      .map((result) => result?.fetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? new Date().toISOString();

  return {
    reporter: {
      code: Number(reporter),
      name: importsRow?.reporterDesc ?? exportsRow?.reporterDesc ?? null
    },
    year,
    flow,
    flowLabel: importsRow?.flowDesc ?? exportsRow?.flowDesc ?? null,
    totals: {
      imports: { value: importValue, basis: "CIF" },
      exports: { value: exportValue, basis: "FOB" },
      balance: { value: balance, basis: "imports - exports" }
    },
    topPartners: rankRows(partnersResult?.response.data ?? [], "partnerCode", "partnerDesc", flowValue, limit),
    topCommodities: rankRows(commoditiesResult?.response.data ?? [], "cmdCode", "cmdDesc", flowValue, limit),
    series: buildSeries(seriesResult?.response.data ?? []),
    partial: unavailable.length > 0,
    unavailable,
    provenance: {
      source: "UN Comtrade",
      upstream: "comtradeapi.un.org",
      dataset: "Comtrade Plus — HS Rev.6 (H6), annual totals",
      fetchedAt,
      cached: [importsResult, exportsResult, partnersResult, commoditiesResult, seriesResult]
        .filter((result): result is ComtradeResult => result !== null)
        .every((result) => result.cached),
      note:
        "Annual aggregated figures. Imports are CIF, exports are FOB, and partner code 0 means World. Not a customs declaration."
    }
  };
}

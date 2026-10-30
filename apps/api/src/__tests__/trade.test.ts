import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { buildApp } from "../app.js";
import { env } from "../config/env.js";
import { clearPublicCallHistory, clearTradeCache, comtradeGet } from "../trade/comtrade.js";

let app: any;
let token: string;

const ORIGINAL_PRIMARY = env.COMTRADE_API_KEY;
const ORIGINAL_SECONDARY = env.COMTRADE_API_KEY_SECONDARY;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email: `trade-${Date.now()}@example.com`,
      password: "password123",
      displayName: "Trade Tester"
    }
  });
  token = JSON.parse(res.payload).token;
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  env.COMTRADE_API_KEY = ORIGINAL_PRIMARY;
  env.COMTRADE_API_KEY_SECONDARY = ORIGINAL_SECONDARY;
  clearTradeCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(rows: unknown[], status = 200) {
  return new Response(JSON.stringify({ data: rows }), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function totalsRow(overrides: Record<string, unknown>) {
  return {
    reporterCode: 818,
    reporterDesc: "Egypt",
    period: "2023",
    partnerCode: 0,
    cmdCode: "TOTAL",
    cmdDesc: "All Commodities",
    primaryValue: 0,
    ...overrides
  };
}

/**
 * Deterministic upstream stub. It dispatches on the same parameters the real client
 * sends, so the test exercises the real request construction.
 */
function stubUpstream() {
  return vi.fn(async (input: any, _init?: any) => {
    const url = new URL(String(input));
    const flow = url.searchParams.get("flowCode");
    const cmd = url.searchParams.get("cmdCode");
    const partner = url.searchParams.get("partnerCode");
    const period = url.searchParams.get("period") ?? "";

    if (cmd === "TOTAL" && partner === "0" && !period.includes(",")) {
      if (flow === "M") {
        return jsonResponse([
          totalsRow({ flowCode: "M", flowDesc: "Import", cifvalue: 1000, primaryValue: 1000 })
        ]);
      }
      return jsonResponse([
        totalsRow({ flowCode: "X", flowDesc: "Export", fobvalue: 400, primaryValue: 400 })
      ]);
    }

    if (cmd === "TOTAL" && partner === "") {
      return jsonResponse([
        { partnerCode: 0, partnerDesc: "World", primaryValue: 1000 },
        { partnerCode: 156, partnerDesc: "China", primaryValue: 300 },
        { partnerCode: 842, partnerDesc: "USA", primaryValue: 200 },
        { partnerCode: 643, partnerDesc: "Russian Federation", primaryValue: 100 }
      ]);
    }

    if (cmd === "AG2") {
      return jsonResponse([
        { cmdCode: "27", cmdDesc: "Mineral fuels", primaryValue: 500 },
        { cmdCode: "84", cmdDesc: "Machinery", primaryValue: 250 },
        { cmdCode: "10", cmdDesc: "Cereals", primaryValue: 150 }
      ]);
    }

    // Public preview accepts one period per call; the client assembles the series.
    if (period.includes(",")) {
      return jsonResponse([2019, 2020, 2021, 2022, 2023].map((value) => ({ period: String(value), primaryValue: value * 10 })));
    }
    return jsonResponse([{ period, primaryValue: Number(period) * 10 }]);
  });
}

describe("trade overview", () => {
  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/trade/overview" });
    expect(res.statusCode).toBe(401);

    const status = await app.inject({ method: "GET", url: "/api/v1/trade/status" });
    expect(status.statusCode).toBe(401);
  });

  it("reports configuration without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    env.COMTRADE_API_KEY = "configured-but-never-sent";
    const configured = await app.inject({
      method: "GET",
      url: "/api/v1/trade/status",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(configured.statusCode).toBe(200);
    expect(JSON.parse(configured.payload).configured).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    env.COMTRADE_API_KEY = undefined;
    env.COMTRADE_API_KEY_SECONDARY = undefined;
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/trade/status",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(JSON.parse(missing.payload).configured).toBe(true);
    expect(JSON.parse(missing.payload).status).toBe("PUBLIC_API");
  });

  it("uses the public preview API and preserves the overview contract without a key", async () => {
    env.COMTRADE_API_KEY = undefined;
    env.COMTRADE_API_KEY_SECONDARY = undefined;

    const fetchMock = stubUpstream();
    vi.stubGlobal("fetch", fetchMock);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2023",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totals).toBeDefined();
    expect(body.topPartners).toBeInstanceOf(Array);
    expect(body.topCommodities).toBeInstanceOf(Array);
    expect(body.series).toBeInstanceOf(Array);
    expect(body.provenance).toMatchObject({ source: "UN Comtrade", cached: false });
    expect(body.provenance.provider).toBe("PUBLIC_API");
    expect(fetchMock.mock.calls.every((call: any) => String(call[0]).includes("/public/v1/preview/C/A/HS"))).toBe(true);
    expect(fetchMock.mock.calls.every((call: any) => !call[1]?.headers?.["Ocp-Apim-Subscription-Key"])).toBe(true);
  });

  it("derives totals, rankings, shares and series from upstream rows", async () => {
    env.COMTRADE_API_KEY = "test-key-primary";
    env.COMTRADE_API_KEY_SECONDARY = undefined;

    const fetchMock = stubUpstream();
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2023&flow=M&limit=5",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.reporter).toEqual({ code: 818, name: "Egypt" });
    expect(body.totals.imports.value).toBe(1000);
    expect(body.totals.imports.basis).toBe("CIF");
    expect(body.totals.exports.value).toBe(400);
    expect(body.totals.exports.basis).toBe("FOB");
    expect(body.totals.balance.value).toBe(600);

    // World (code 0) must never appear as a partner.
    expect(body.topPartners.map((row: any) => row.code)).toEqual(["156", "842", "643"]);
    expect(body.topPartners[0].share).toBe(30);

    expect(body.topCommodities[0]).toMatchObject({ code: "27", value: 500, share: 50 });

    expect(body.series.map((row: any) => row.year)).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(body.series.at(-1).value).toBe(20230);

    expect(body.partial).toBe(false);
    expect(body.provenance.source).toBe("UN Comtrade");
    expect(body.provenance.cached).toBe(false);

    // Five subscription calls: imports, exports, partners, chapters, series.
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // The key is a header, never part of the URL.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("test-key-primary");
      expect(String(call[0])).toContain("/data/v1/get/C/A/HS");
      expect((call[1] as any).headers["Ocp-Apim-Subscription-Key"]).toBe("test-key-primary");
    }
    expect(fetchMock.mock.calls.some((call: any) => new URL(String(call[0])).searchParams.get("period") === "2019,2020,2021,2022,2023")).toBe(true);
  });

  it("serves repeated requests from cache without extra upstream calls", async () => {
    env.COMTRADE_API_KEY = "test-key-primary";
    const fetchMock = stubUpstream();
    vi.stubGlobal("fetch", fetchMock);

    const url = "/api/v1/trade/overview?reporter=999&year=2023&flow=M";

    const first = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.payload).provenance.cached).toBe(false);

    const second = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload).provenance.cached).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("falls back to the secondary key when the primary is rejected", async () => {
    env.COMTRADE_API_KEY = "primary-rejected";
    env.COMTRADE_API_KEY_SECONDARY = "secondary-accepted";

    const seenKeys: string[] = [];
    const fetchMock = vi.fn(async (_input: any, init: any) => {
      const key = init.headers["Ocp-Apim-Subscription-Key"];
      seenKeys.push(key);
      if (key === "primary-rejected") {
        return new Response(JSON.stringify({ message: "invalid key" }), { status: 401 });
      }
      return jsonResponse([
        totalsRow({ flowCode: "M", flowDesc: "Import", cifvalue: 10, primaryValue: 10 })
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2022",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    expect(seenKeys).toContain("primary-rejected");
    expect(seenKeys).toContain("secondary-accepted");
  });

  it("surfaces upstream rate limiting as 503 with a stable code", async () => {
    env.COMTRADE_API_KEY = "rate-limited-key";
    env.COMTRADE_API_KEY_SECONDARY = undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "too many" }), {
        status: 429,
        headers: { "retry-after": "30" }
      }))
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2021",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBe(30);
  });

  it("enforces the public daily request cap and releases queued callers", async () => {
    env.COMTRADE_API_KEY = undefined;
    env.COMTRADE_API_KEY_SECONDARY = undefined;
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    clearPublicCallHistory();
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("setTimeout", ((callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
      now += Number(delay);
      callback(...args);
      return 1 as any;
    }) as any);

    // Fill the documented free tier's daily allowance through unique cached keys.
    for (let index = 0; index < 500; index += 1) {
      await comtradeGet({ reporterCode: String(index), period: "2023", cmdCode: "TOTAL", flowCode: "M" });
    }
    await expect(comtradeGet({ reporterCode: "daily-cap", period: "2023", cmdCode: "TOTAL", flowCode: "M" }))
      .rejects.toMatchObject({ code: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(500);
  }, 700000);

  it("keeps the overview fields required by the frontend", async () => {
    env.COMTRADE_API_KEY = "frontend-contract-key";
    env.COMTRADE_API_KEY_SECONDARY = undefined;
    vi.stubGlobal("fetch", stubUpstream());
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2023&flow=M&limit=5",
      headers: { authorization: `Bearer ${token}` }
    });
    const body = JSON.parse(res.payload);
    expect(body).toMatchObject({
      reporter: { code: 818 }, year: 2023, flow: "M",
      totals: { imports: { basis: "CIF" }, exports: { basis: "FOB" } },
      partial: false,
      provenance: { source: "UN Comtrade", upstream: "comtradeapi.un.org", cached: false, provider: "SUBSCRIPTION_API" }
    });
    expect(body.topPartners[0]).toHaveProperty("share");
    expect(body.topCommodities[0]).toHaveProperty("name");
    expect(body.series[0]).toEqual({ year: 2019, value: 20190 });
  });

  it("normalizes timeouts, upstream failures, and malformed JSON schemas", async () => {
    env.COMTRADE_API_KEY = undefined;
    env.COMTRADE_API_KEY_SECONDARY = undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: any, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    env.COMTRADE_REQUEST_TIMEOUT_MS = "5";
    const timeout = await app.inject({ method: "GET", url: "/api/v1/trade/overview?year=2020", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(timeout.payload).code).toBe("timeout");
    const statusAfterFailure = await app.inject({ method: "GET", url: "/api/v1/trade/status", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(statusAfterFailure.payload)).toMatchObject({ status: "UNAVAILABLE", explanation: "Comtrade did not respond in time." });

    env.COMTRADE_REQUEST_TIMEOUT_MS = "12000";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const upstream = await app.inject({ method: "GET", url: "/api/v1/trade/overview?year=2020", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(upstream.payload).code).toBe("upstream_error");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: "bad" }), { status: 200 })));
    const invalid = await app.inject({ method: "GET", url: "/api/v1/trade/overview?year=2020", headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(invalid.payload).code).toBe("invalid_response");
  });

  it("rejects invalid query parameters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=abc&flow=Z&limit=500",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("Invalid query");
  });
});

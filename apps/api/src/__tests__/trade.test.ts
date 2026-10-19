import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { buildApp } from "../app.js";
import { env } from "../config/env.js";
import { clearTradeCache } from "../trade/comtrade.js";

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

    // Five-year series.
    return jsonResponse([
      { period: "2023", primaryValue: 1000 },
      { period: "2019", primaryValue: 700 },
      { period: "2022", primaryValue: 950 },
      { period: "2021", primaryValue: 850 },
      { period: "2020", primaryValue: 800 }
    ]);
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
    expect(JSON.parse(missing.payload).configured).toBe(false);
  });

  it("returns 503 instead of fabricated data when no key is configured", async () => {
    env.COMTRADE_API_KEY = undefined;
    env.COMTRADE_API_KEY_SECONDARY = undefined;

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/trade/overview?reporter=818&year=2023",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("not_configured");
    expect(body.error).toMatch(/not configured/i);
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
    expect(body.series.at(-1).value).toBe(1000);

    expect(body.partial).toBe(false);
    expect(body.provenance.source).toBe("UN Comtrade");
    expect(body.provenance.cached).toBe(false);

    // Five upstream calls: imports, exports, partners, chapters, series.
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // The key is a header, never part of the URL.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("test-key-primary");
      expect((call[1] as any).headers["Ocp-Apim-Subscription-Key"]).toBe("test-key-primary");
    }
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

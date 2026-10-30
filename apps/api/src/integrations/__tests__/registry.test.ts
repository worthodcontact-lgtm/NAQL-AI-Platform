import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ databaseReachable: vi.fn() }));
vi.mock("../../db.js", () => ({ databaseReachable: mocks.databaseReachable, persistenceMode: "database" }));
vi.mock("../../config/env.js", () => ({ env: {
  AI_SERVICE_URL: "http://127.0.0.1:8000", AI_REQUEST_TIMEOUT_MS: "1000", AI_PROVIDER: "none",
  STORAGE_PATH: "", MALWARE_SCANNER: "none", COMTRADE_API_KEY: "", COMTRADE_API_KEY_SECONDARY: ""
} }));

describe("integration status registry", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("reports only evidence-backed availability and does not leak credentials", async () => {
    mocks.databaseReachable.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ capabilities: { pdfText: true, ocr: false } }) }));
    const { getIntegrationRegistry } = await import("../registry.js");
    const { items } = await getIntegrationRegistry();
    expect(items.find((item) => item.id === "database")?.status).toBe("AVAILABLE");
    expect(items.find((item) => item.id === "pdf-ocr")?.status).toBe("DEGRADED");
    expect(items.find((item) => item.id === "pdf-ocr")).toMatchObject({ configuration: "configured", connectivity: "verified", operation: "not_verified" });
    expect(items.find((item) => item.id === "database")).toMatchObject({ configuration: "configured", connectivity: "verified", operation: "verified" });
    expect(items.find((item) => item.id === "ai")?.status).toBe("NOT_CONFIGURED");
    expect(items.find((item) => item.id === "whatsapp")?.status).toBe("NOT_CONFIGURED");
    expect(JSON.stringify(items)).not.toContain("API_KEY");
  });

  it("does not mark a configured extraction service available when its probe fails", async () => {
    mocks.databaseReachable.mockResolvedValue(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive provider detail")));
    const { getIntegrationRegistry } = await import("../registry.js");
    const { items } = await getIntegrationRegistry();
    expect(items.find((item) => item.id === "database")?.status).toBe("UNAVAILABLE");
    expect(items.find((item) => item.id === "pdf-ocr")?.status).toBe("UNAVAILABLE");
    expect(items.find((item) => item.id === "pdf-ocr")).toMatchObject({ configuration: "configured", connectivity: "failed", operation: "not_verified" });
    expect(JSON.stringify(items)).not.toContain("sensitive provider detail");
  });
});

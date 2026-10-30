import { env } from "../config/env.js";
import { databaseReachable, persistenceMode } from "../db.js";

export type IntegrationStatus = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED" | "UNVERIFIED";
export type IntegrationConfiguration = "configured" | "not_configured";
export type IntegrationConnectivity = "verified" | "failed" | "not_checked" | "not_applicable";
export type IntegrationOperation = "verified" | "not_verified" | "not_available";

export interface IntegrationRecord {
  id: string;
  provider: string;
  status: IntegrationStatus;
  configuration: IntegrationConfiguration;
  connectivity: IntegrationConnectivity;
  operation: IntegrationOperation;
  capabilities: string[];
  evidence: string;
  checkedAt: string;
  nextAction?: string;
}

async function probeExtractionService(): Promise<{ ok: boolean; pdfText?: boolean; ocr?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(3000, Math.max(500, Number(env.AI_REQUEST_TIMEOUT_MS) || 3000)));
  try {
    const response = await fetch(`${env.AI_SERVICE_URL.replace(/\/$/, "")}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { capabilities?: { pdfText?: boolean; ocr?: boolean } };
    return { ok: true, pdfText: body.capabilities?.pdfText === true, ocr: body.capabilities?.ocr === true };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Reports evidence-backed operational state. Configuration alone is never a connectivity check. */
export async function getIntegrationRegistry(): Promise<{ generatedAt: string; items: IntegrationRecord[] }> {
  const checkedAt = new Date().toISOString();
  const [database, extraction] = await Promise.all([databaseReachable(), probeExtractionService()]);
  const configuredAi = env.AI_PROVIDER !== "none";
  const configuredEmail =
    env.EMAIL_PROVIDER === "resend" &&
    Boolean(env.EMAIL_API_KEY?.trim()) &&
    Boolean(env.EMAIL_FROM?.trim());
  const items: Omit<IntegrationRecord, "configuration" | "connectivity" | "operation">[] = [
    { id: "database", provider: "PostgreSQL", status: database ? "AVAILABLE" : "UNAVAILABLE", capabilities: ["business-data persistence"], evidence: database ? "SELECT 1 succeeded" : persistenceMode === "memory" ? "No DATABASE_URL configured" : "Connectivity check failed", checkedAt },
    { id: "ai", provider: env.AI_PROVIDER === "openai-compatible" ? "OpenAI-compatible" : env.AI_PROVIDER, status: configuredAi ? "UNVERIFIED" : "NOT_CONFIGURED", capabilities: ["structured inference"], evidence: configuredAi ? "Provider configured; no live operation verified by this status check" : "Deterministic no-provider mode", checkedAt, ...(!configuredAi ? { nextAction: "Configure a server-side provider and verify a small safe inference" } : {}) },
    { id: "pdf-ocr", provider: "NAQL extraction service", status: !extraction.ok ? (env.AI_SERVICE_URL ? "UNAVAILABLE" : "NOT_CONFIGURED") : extraction.ocr && extraction.pdfText ? "AVAILABLE" : "DEGRADED", capabilities: ["PDF text extraction", "image OCR"], evidence: !extraction.ok ? "Health probe failed or timed out" : `Health probe succeeded; pdfText=${extraction.pdfText}; ocr=${extraction.ocr}`, checkedAt, ...(!extraction.ok || !extraction.ocr ? { nextAction: "Install and verify the required PDF/OCR engine in the extraction service" } : {}) },
    { id: "object-storage", provider: env.STORAGE_PATH ? "Local filesystem" : "In-memory development storage", status: env.STORAGE_PATH ? "UNVERIFIED" : "DEGRADED", capabilities: ["document object storage"], evidence: env.STORAGE_PATH ? "Storage path configured; write/read probe not performed" : "Process-memory storage is not durable", checkedAt, nextAction: env.STORAGE_PATH ? "Run a write/read/delete verification and confirm backup coverage" : "Configure durable private storage before staging" },
    { id: "malware-scanning", provider: env.MALWARE_SCANNER === "clamav" ? "ClamAV" : "None", status: env.MALWARE_SCANNER === "clamav" ? "UNVERIFIED" : "NOT_CONFIGURED", capabilities: ["upload malware scanning"], evidence: env.MALWARE_SCANNER === "clamav" ? "Scanner configured; scan operation not verified" : "Uploads are explicitly marked not_scanned", checkedAt },
    { id: "un-comtrade", provider: "UN Comtrade", status: env.COMTRADE_API_KEY || env.COMTRADE_API_KEY_SECONDARY ? "UNVERIFIED" : "NOT_CONFIGURED", capabilities: ["trade statistics"], evidence: "No live API operation was run by this status check", checkedAt, nextAction: "Obtain a subscription key and execute a bounded API request" },
    { id: "email", provider: configuredEmail ? "Resend" : "Not selected", status: configuredEmail ? "UNVERIFIED" : "NOT_CONFIGURED", capabilities: ["external email delivery"], evidence: configuredEmail ? "Provider and sender configured; no live delivery was verified by this status check" : "No email delivery adapter or credentials configured; notifications remain in-app only", checkedAt, ...(configuredEmail ? { nextAction: "Verify a controlled delivery and record provider message id, sender/domain, and bounce handling" } : {}) },
    { id: "whatsapp", provider: "Meta WhatsApp Business Platform", status: "NOT_CONFIGURED", capabilities: ["external messaging"], evidence: "No WhatsApp Business account, approved sender, or credentials configured", checkedAt },
    { id: "carrier-tracking", provider: "Carrier-specific APIs", status: "NOT_CONFIGURED", capabilities: ["shipment tracking"], evidence: "No carrier API credentials or adapter configured; internal manual milestones remain available", checkedAt },
    { id: "ais", provider: "MarineTraffic / Kpler", status: "NOT_CONFIGURED", capabilities: ["vessel position and events"], evidence: "No commercial API credentials configured", checkedAt },
    { id: "egypt-customs", provider: "Egyptian Customs / Nafeza", status: "NOT_CONFIGURED", capabilities: ["customs and ACI workflow"], evidence: "No adapter, authorized API access, or credentials are configured", checkedAt, nextAction: "Request written integration and authorization requirements from the authority or Nafeza operator" },
    { id: "maps", provider: "Not selected", status: "NOT_CONFIGURED", capabilities: ["geocoding and route information"], evidence: "No maps provider configured; route references use the local port directory", checkedAt }
  ];
  const enriched = items.map((item): IntegrationRecord => {
    const configured = item.status !== "NOT_CONFIGURED";
    const connectivity: IntegrationConnectivity =
      item.status === "AVAILABLE" || item.status === "DEGRADED" ? "verified" :
      item.status === "UNAVAILABLE" ? "failed" :
      configured ? "not_checked" : "not_applicable";
    const operation: IntegrationOperation =
      item.id === "database" && item.status === "AVAILABLE" ? "verified" :
      item.status === "NOT_CONFIGURED" ? "not_available" : "not_verified";
    return { ...item, configuration: configured ? "configured" : "not_configured", connectivity, operation };
  });
  return { generatedAt: checkedAt, items: enriched };
}

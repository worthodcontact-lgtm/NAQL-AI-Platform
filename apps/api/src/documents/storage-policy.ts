import { createHash } from "node:crypto";
import { COMPANY_DOCUMENT_RETENTION_DAYS, DOCUMENT_RETENTION_DAYS } from "../config/env.js";

/** SHA-256 is stored so an operator can detect changed or duplicate bytes. */
export function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function retentionUntil(days: number, from = new Date()): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + Math.floor(days) * 86_400_000);
}

export function shipmentDocumentRetention(): Date | null {
  return retentionUntil(DOCUMENT_RETENTION_DAYS);
}

export function companyDocumentRetention(): Date | null {
  return retentionUntil(COMPANY_DOCUMENT_RETENTION_DAYS);
}

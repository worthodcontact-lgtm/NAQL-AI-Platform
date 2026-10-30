import { prisma } from "../db.js";
import type { AuthUser } from "../auth/routes.js";
import { loadShipmentAccess, partyAllows, visibleShipmentWhere } from "../shipments/access.js";
import { AI_RAG_TOP_K } from "../config/env.js";

/**
 * Deterministic retrieval adapter.
 *
 * No embedding model is available in this environment, so this is keyword and
 * record retrieval over authorized PostgreSQL rows, not semantic search. The
 * method is returned explicitly. Every query starts from the authenticated user
 * and a shipment access check; a client-supplied organization id is never used.
 */

export const RETRIEVAL_METHOD = "deterministic-keyword-v1";

export interface RetrievalSource {
  type: "shipment" | "document" | "finding" | "quotation" | "milestone";
  id: string;
  label: string;
  documentId?: string;
  documentType?: string;
  code?: string;
  severity?: string;
}

export interface RetrievalChunk {
  id: string;
  text: string;
  source: RetrievalSource;
  score: number;
}

export interface RetrievalResult {
  method: typeof RETRIEVAL_METHOD;
  empty: boolean;
  chunks: RetrievalChunk[];
  sources: RetrievalSource[];
  shipmentId?: string;
}

const MAX_CHUNKS = 40;
const MAX_CONTEXT_CHARS = 24_000;

function tokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06ff]+/)
        .filter((token) => token.length >= 2)
        .slice(0, 40)
    )
  );
}

function scoreText(text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

function clampText(value: string, max = 6000): string {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function fieldSummary(fields: unknown): string {
  if (!Array.isArray(fields)) return "";
  return fields
    .slice(0, 80)
    .map((field: any) => {
      if (!field || typeof field !== "object") return "";
      const value = field.normalizedValue ?? field.value;
      return `${field.label ?? field.key}: ${value === null || value === undefined ? "(missing)" : String(value)} [${field.validationStatus ?? "unknown"}]`;
    })
    .filter(Boolean)
    .join("\n");
}

function sourceForDocument(document: any): RetrievalSource {
  return {
    type: "document",
    id: document.id,
    label: document.filename,
    documentId: document.id,
    documentType: document.extraction?.documentType ?? document.type
  };
}

async function shipmentContext(input: {
  shipmentId: string;
  user: AuthUser;
  queryTokens: string[];
  includeDocuments: boolean;
}): Promise<RetrievalResult | null> {
  if (!prisma) return null;
  const access = await loadShipmentAccess(input.user, input.shipmentId);
  if (!access || !partyAllows(access, "view")) return null;

  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      originPort: { select: { code: true, name: true, country: true } },
      destinationPort: { select: { code: true, name: true, country: true } },
      milestones: { orderBy: { occurredAt: "asc" } },
      documents: {
        include: { extraction: true },
        orderBy: { uploadedAt: "asc" }
      },
      quotationRequests: {
        include: { offers: { select: { id: true, currency: true, amount: true, transitDays: true }, take: 5 } },
        take: 1
      }
    }
  });
  if (!shipment) return null;
  if (!access.isOwner && shipment.organizationId !== input.user.organizationId && !access.party) return null;

  const chunks: RetrievalChunk[] = [];
  const shipmentSource: RetrievalSource = {
    type: "shipment",
    id: shipment.id,
    label: shipment.reference
  };
  const summary = [
    `Shipment ${shipment.reference}: status ${shipment.status}, mode ${shipment.mode}, incoterm ${shipment.incoterm}.`,
    `Cargo: ${shipment.cargoDescription}. Weight: ${String(shipment.weightKg)} kg.`,
    `Route: ${shipment.originPort.code} ${shipment.originPort.name}, ${shipment.originPort.country} -> ${shipment.destinationPort.code} ${shipment.destinationPort.name}, ${shipment.destinationPort.country}.`,
    `Created at ${shipment.createdAt.toISOString()}.`
  ].join(" ");
  chunks.push({
    id: `shipment:${shipment.id}`,
    text: summary,
    source: shipmentSource,
    score: scoreText(summary, input.queryTokens)
  });

  if (shipment.milestones.length > 0) {
    const text = shipment.milestones
      .map((milestone) => `${milestone.code}: ${milestone.status}${milestone.occurredAt ? ` at ${milestone.occurredAt.toISOString()}` : ""}`)
      .join("\n");
    chunks.push({
      id: `milestones:${shipment.id}`,
      text: `Milestones for ${shipment.reference}:\n${text}`,
      source: { type: "milestone", id: `${shipment.id}:milestones`, label: "Shipment milestones" },
      score: scoreText(text, input.queryTokens)
    });
  }

  const findings = await prisma.documentFinding.findMany({
    where: {
      shipmentId: shipment.id,
      organizationId: input.user.organizationId
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  for (const finding of findings) {
    const text = `${finding.severity} ${finding.code}: ${finding.message}${finding.suggestedAction ? ` Suggested action: ${finding.suggestedAction}` : ""}`;
    chunks.push({
      id: `finding:${finding.id}`,
      text,
      source: {
        type: "finding",
        id: finding.id,
        label: `${finding.code} (${finding.severity})`,
        documentId: finding.documentId,
        code: finding.code,
        severity: finding.severity
      },
      score: scoreText(text, input.queryTokens)
    });
  }

  if (input.includeDocuments) {
    for (const document of shipment.documents) {
      // Private documents are visible only to the uploader organization and the
      // shipment owner. A party without canViewDocuments never reaches this code.
      const allowed =
        access.isOwner ||
        (partyAllows(access, "viewDocuments") &&
          (document.visibility === "shipment" || document.uploadedByOrganizationId === input.user.organizationId));
      if (!allowed) continue;

      const extraction = document.extraction;
      const fields = extraction ? fieldSummary(extraction.fields) : "";
      const rawText = extraction?.extractedText ? `\nExtracted text (untrusted):\n${clampText(extraction.extractedText, 5000)}` : "";
      const text = [
        `Document ${document.filename} (${document.type}), status ${document.status}.`,
        extraction
          ? `Extraction status: ${extraction.status}; type: ${extraction.documentType ?? "unknown"}; method: ${extraction.extractionMethod ?? "unknown"}; OCR: ${extraction.ocrStatus}; malware scan: ${extraction.malwareScanStatus}.`
          : "This document has not been processed.",
        fields ? `Fields:\n${fields}` : "",
        rawText
      ]
        .filter(Boolean)
        .join("\n");
      chunks.push({
        id: `document:${document.id}`,
        text,
        source: sourceForDocument(document),
        score: scoreText(text, input.queryTokens)
      });
    }
  }

  const canSeeFinancials = access.isOwner || partyAllows(access, "viewFinancials");
  if (canSeeFinancials) {
    for (const request of shipment.quotationRequests) {
      for (const offer of request.offers) {
        const text = `Quotation offer ${offer.id}: ${offer.currency} ${String(offer.amount)}, transit ${offer.transitDays} days.`;
        chunks.push({
          id: `quotation:${offer.id}`,
          text,
          source: { type: "quotation", id: offer.id, label: `Quotation ${offer.currency} ${String(offer.amount)}` },
          score: scoreText(text, input.queryTokens)
        });
      }
    }
  }

  return finalizeRetrieval(chunks, shipment.id);
}

function finalizeRetrieval(chunks: RetrievalChunk[], shipmentId?: string): RetrievalResult {
  const ranked = chunks
    .filter((chunk) => chunk.score > 0 || chunk.source.type === "shipment")
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const selected: RetrievalChunk[] = [];
  let used = 0;
  for (const chunk of ranked.slice(0, MAX_CHUNKS)) {
    if (used + chunk.text.length > MAX_CONTEXT_CHARS) break;
    selected.push(chunk);
    used += chunk.text.length;
  }

  const sources: RetrievalSource[] = [];
  const seen = new Set<string>();
  for (const chunk of selected) {
    const key = `${chunk.source.type}:${chunk.source.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(chunk.source);
  }

  return {
    method: RETRIEVAL_METHOD,
    empty: selected.length === 0,
    chunks: selected,
    sources,
    ...(shipmentId ? { shipmentId } : {})
  };
}

export async function retrieveContext(input: {
  user: AuthUser;
  query: string;
  shipmentId?: string;
  topK?: number;
}): Promise<RetrievalResult> {
  const topK = Math.max(1, Math.min(20, input.topK ?? AI_RAG_TOP_K));
  const queryTokens = tokens(input.query);

  if (input.shipmentId) {
    const result = await shipmentContext({
      shipmentId: input.shipmentId,
      user: input.user,
      queryTokens,
      includeDocuments: true
    });
    if (!result) {
      return { method: RETRIEVAL_METHOD, empty: true, chunks: [], sources: [], shipmentId: input.shipmentId };
    }
    return { ...result, chunks: result.chunks.slice(0, topK) };
  }

  if (!prisma) return { method: RETRIEVAL_METHOD, empty: true, chunks: [], sources: [] };

  // Global search is limited to shipments the user can view. Each candidate is
  // re-checked with loadShipmentAccess so a party's document flags are honored.
  const shipments = await prisma.shipment.findMany({
    where: visibleShipmentWhere(input.user),
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true }
  });

  const chunks: RetrievalChunk[] = [];
  for (const candidate of shipments) {
    const result = await shipmentContext({
      shipmentId: candidate.id,
      user: input.user,
      queryTokens,
      includeDocuments: true
    });
    if (!result) continue;
    chunks.push(...result.chunks);
  }

  const result = finalizeRetrieval(chunks);
  return { ...result, chunks: result.chunks.slice(0, topK) };
}

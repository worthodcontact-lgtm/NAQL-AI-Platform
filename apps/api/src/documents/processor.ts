import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { storageAdapter } from "../storage/adapter.js";
import { aiGateway } from "../ai/gateway.js";
import { recordAiExecution } from "../ai/execution.js";
import { malwareStatusMessage } from "./malware.js";
import { extractDocument, extractText, type DocumentType, type ExtractedField } from "./extraction.js";

export interface ProcessingResult {
  documentId: string;
  status: "processing" | "completed" | "unavailable" | "failed";
  documentType?: string;
  extractionMethod?: string;
  ocrStatus?: string;
  malwareScanStatus: string;
  fields: ExtractedField[];
  warnings: string[];
  provider?: string;
  model?: string;
  errorCode?: string;
  errorMessage?: string;
  updatedAt?: string;
}

function inferContentType(filename: string, stored?: string | null): string {
  if (stored) return stored.toLowerCase().split(";")[0].trim();
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    txt: "text/plain"
  };
  return map[extension] ?? "application/octet-stream";
}

function fieldJson(fields: ExtractedField[]): unknown {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: field.value,
    normalizedValue: field.normalizedValue ?? null,
    method: field.method,
    ...(field.confidence !== undefined ? { confidence: field.confidence } : {}),
    ...(field.page !== undefined ? { page: field.page } : {}),
    ...(field.sourceLocation ? { sourceLocation: field.sourceLocation } : {}),
    validationStatus: field.validationStatus
  }));
}

/**
 * Process a document that already passed upload authorization.
 *
 * Persistence is idempotent: a current `DocumentExtraction` row is upserted for
 * the document. A failed/unavailable result is stored too, so the UI never
 * shows a stale success after a retry.
 */
export async function processDocument(input: {
  documentId: string;
  organizationId: string;
  userId: string;
  typeHint?: DocumentType;
}): Promise<ProcessingResult | null> {
  if (!prisma) return null;

  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    include: { shipment: { select: { id: true, organizationId: true, reference: true } } }
  });
  if (!document) return null;
  const isOwner = document.shipment.organizationId === input.organizationId;
  if (!isOwner && document.uploadedByOrganizationId !== input.organizationId) return null;

  const contentType = inferContentType(document.filename, document.contentType);
  const scanStatus = document.malwareScanStatus ?? "not_scanned";
  const warnings: string[] = [malwareStatusMessage(scanStatus)];

  if (scanStatus === "infected") {
    return {
      documentId: document.id,
      status: "failed",
      malwareScanStatus: scanStatus,
      fields: [],
      warnings,
      errorCode: "document_quarantined",
      errorMessage: "The document is quarantined and will not be processed."
    };
  }

  const runId = randomUUID();
  const claimed = await claimProcessing(document.id, input.organizationId, runId, scanStatus, warnings);
  if (!claimed) {
    const current = await prisma.documentExtraction.findUnique({ where: { documentId: document.id } });
    if (!current) return null;
    return {
      documentId: document.id,
      status: current.status === "processing" ? "processing" : (current.status as ProcessingResult["status"]),
      documentType: current.documentType ?? undefined,
      extractionMethod: current.extractionMethod ?? undefined,
      ocrStatus: current.ocrStatus,
      malwareScanStatus: current.malwareScanStatus,
      fields: (current.fields as unknown as ExtractedField[]) ?? [],
      warnings: (current.warnings as string[]) ?? [],
      provider: current.provider ?? undefined,
      model: current.model ?? undefined,
      errorCode: current.errorCode ?? undefined,
      errorMessage: current.errorMessage ?? undefined,
      updatedAt: current.updatedAt.toISOString()
    };
  }

  let buffer: Buffer;
  try {
    buffer = await storageAdapter.read(document.storageKey);
  } catch {
    const result: ProcessingResult = {
      documentId: document.id,
      status: "failed",
      malwareScanStatus: scanStatus,
      fields: [],
      warnings: [...warnings, "The stored file is missing or unreadable."],
      errorCode: "document_bytes_unavailable",
      errorMessage: "The stored file is missing or unreadable."
    };
    await persistExtraction(document.id, input.organizationId, result, runId);
    return result;
  }

  if (buffer.length === 0) {
    const result: ProcessingResult = {
      documentId: document.id,
      status: "failed",
      malwareScanStatus: scanStatus,
      fields: [],
      warnings: [...warnings, "The stored file is empty."],
      errorCode: "empty_document",
      errorMessage: "The stored file is empty."
    };
    await persistExtraction(document.id, input.organizationId, result, runId);
    return result;
  }

  const textResult = await extractText({
    buffer,
    contentType,
    filename: document.filename
  });
  warnings.push(...textResult.warnings);

  if (textResult.status !== "ok" || !textResult.text?.trim()) {
    const result: ProcessingResult = {
      documentId: document.id,
      status: "unavailable",
      ocrStatus: textResult.ocrStatus,
      malwareScanStatus: scanStatus,
      fields: [],
      warnings,
      errorCode: textResult.errorCode ?? "text_extraction_unavailable",
      errorMessage: "No text could be extracted. The document may be scanned or in an unsupported format."
    };
    await persistExtraction(document.id, input.organizationId, result, runId);
    return result;
  }

  const extraction = await extractDocument({
    text: textResult.text.slice(0, 50000),
    typeHint: input.typeHint ?? (document.type as DocumentType | undefined),
    gateway: aiGateway
  });

  if (extraction.provider) {
    await recordAiExecution({
      organizationId: input.organizationId,
      userId: input.userId,
      operation: "document_extract",
      result: {
        status: extraction.providerStatus ?? (extraction.method.includes("ai-provider") ? "completed" : "failure"),
        provider: extraction.provider ?? "none",
        model: extraction.model,
        usage: extraction.providerUsage ?? {},
        latencyMs: extraction.providerLatencyMs ?? 0,
        attempts: extraction.providerAttempts ?? 0,
        errorCode: extraction.errorCode,
        errorMessage: extraction.errorMessage
      }
    });
  }

  const result: ProcessingResult = {
    documentId: document.id,
    status: "completed",
    documentType: extraction.documentType,
    extractionMethod: extraction.method,
    ocrStatus: textResult.ocrStatus,
    malwareScanStatus: scanStatus,
    fields: extraction.fields,
    warnings: Array.from(new Set([...warnings, ...extraction.warnings])),
    provider: extraction.provider,
    model: extraction.model,
    errorCode: extraction.errorCode,
    errorMessage: extraction.errorMessage
  };

  await persistExtraction(document.id, input.organizationId, result, runId, textResult.text.slice(0, 50000));
  return result;
}

async function claimProcessing(
  documentId: string,
  organizationId: string,
  runId: string,
  malwareScanStatus: string,
  warnings: string[]
): Promise<boolean> {
  if (!prisma) return false;
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const existing = await prisma.documentExtraction.findUnique({ where: { documentId } });
  if (!existing) {
    try {
      await prisma.documentExtraction.create({
        data: {
          documentId,
          organizationId,
          status: "processing",
          malwareScanStatus,
          warnings: warnings as any,
          processingRunId: runId,
          processingStartedAt: new Date()
        }
      });
      return true;
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      return false;
    }
  }

  const claimed = await prisma.documentExtraction.updateMany({
    where: {
      documentId,
      OR: [
        { status: { not: "processing" } },
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleBefore } }
      ]
    },
    data: {
      status: "processing",
      malwareScanStatus,
      warnings: warnings as any,
      errorCode: null,
      errorMessage: null,
      processingRunId: runId,
      processingStartedAt: new Date()
    }
  });
  return claimed.count === 1;
}

async function persistExtraction(
  documentId: string,
  organizationId: string,
  result: ProcessingResult,
  runId: string,
  extractedText?: string
): Promise<void> {
  if (!prisma) return;
  const fields = fieldJson(result.fields);
  await prisma.$transaction(async (tx) => {
    // Only the run that still owns the claim may write. A stale worker that
    // lost the lease cannot overwrite a newer result.
    const owned = await tx.documentExtraction.updateMany({
      where: { documentId, processingRunId: runId },
      data: {
        status: result.status,
        documentType: result.documentType ?? null,
        classificationMethod: result.documentType ? (result.extractionMethod ?? "deterministic-text-v1") : null,
        extractionMethod: result.extractionMethod ?? null,
        ocrStatus: result.ocrStatus ?? "not_required",
        malwareScanStatus: result.malwareScanStatus,
        provider: result.provider ?? null,
        model: result.model ?? null,
        extractedText: extractedText ?? null,
        fields: fields as any,
        warnings: result.warnings as any,
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        processingRunId: null,
        processingStartedAt: null
      }
    });
    if (owned.count === 0) return;

    await tx.document.update({
      where: { id: documentId },
      data: {
        status:
          result.status === "completed"
            ? "processed"
            : result.status === "unavailable"
              ? "processing_unavailable"
              : "processing_failed",
        validation: JSON.stringify({
          status: result.status,
          documentType: result.documentType,
          fieldCount: result.fields.length,
          warningCount: result.warnings.length,
          errorCode: result.errorCode
        })
      }
    });
  });
}

/** Shape for API responses. Never includes storageKey or extracted text. */
export function processingView(result: ProcessingResult) {
  return {
    documentId: result.documentId,
    status: result.status,
    documentType: result.documentType,
    extractionMethod: result.extractionMethod,
    ocrStatus: result.ocrStatus,
    malwareScanStatus: result.malwareScanStatus,
    fields: result.fields,
    warnings: result.warnings,
    provider: result.provider,
    model: result.model,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
  };
}

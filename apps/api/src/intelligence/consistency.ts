import { prisma } from "../db.js";

/**
 * Deterministic document consistency engine.
 *
 * Rules only use values that were actually extracted from the document or
 * recorded on the shipment. A finding is a review prompt, never a customs or
 * legal determination. Tolerances are explicit and versioned.
 */

export const CONSISTENCY_RULE_VERSION = "2026-10-21.1";

export const CONSISTENCY_TOLERANCES = {
  /** Weight differences within 2% or 0.5 kg are treated as measurement noise. */
  weightRelative: 0.02,
  weightAbsoluteKg: 0.5,
  /** Money differences within 0.01 are rounding noise. */
  moneyAbsolute: 0.01
} as const;

export type FindingSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface ExtractedFieldLike {
  key: string;
  label?: string;
  value: unknown;
  normalizedValue?: unknown;
  validationStatus?: string;
  method?: string;
}

export interface DocumentContext {
  id: string;
  filename: string;
  type: string;
  extraction?: {
    id: string;
    status: string;
    documentType: string | null;
    fields: unknown;
  } | null;
}

export interface ShipmentContext {
  id: string;
  reference: string;
  organizationId: string;
  status: string;
  incoterm: string;
  weightKg: number;
  volumeCbm?: number | null;
  cargoDescription: string;
  originPort: { code: string; name: string; country: string };
  destinationPort: { code: string; name: string; country: string };
  quotationCurrency?: string | null;
  milestones?: Array<{ code: string; status: string; occurredAt?: string | Date | null }>;
}

export interface ConsistencyFinding {
  code: string;
  severity: FindingSeverity;
  documentId: string;
  extractionId?: string;
  field?: string;
  observed?: unknown;
  expected?: unknown;
  message: string;
  suggestedAction: string;
  requiresReview: boolean;
  sourceDocumentIds: string[];
}

function asFields(value: unknown): ExtractedFieldLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ExtractedFieldLike =>
      item !== null && typeof item === "object" && typeof (item as any).key === "string"
  );
}

function fieldOf(document: DocumentContext, key: string): ExtractedFieldLike | undefined {
  return asFields(document.extraction?.fields).find((field) => field.key === key);
}

function numberValue(field: ExtractedFieldLike | undefined): number | null {
  if (!field) return null;
  const raw = field.normalizedValue ?? field.value;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[,_\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(field: ExtractedFieldLike | undefined): string | null {
  if (!field) return null;
  const raw = field.normalizedValue ?? field.value;
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withinWeightTolerance(left: number, right: number): boolean {
  const difference = Math.abs(left - right);
  const allowed = Math.max(CONSISTENCY_TOLERANCES.weightAbsoluteKg, Math.max(Math.abs(left), Math.abs(right)) * CONSISTENCY_TOLERANCES.weightRelative);
  return difference <= allowed;
}

function add(
  findings: ConsistencyFinding[],
  input: Omit<ConsistencyFinding, "requiresReview" | "sourceDocumentIds"> & {
    requiresReview?: boolean;
    sourceDocumentIds?: string[];
  }
): void {
  findings.push({
    ...input,
    requiresReview: input.requiresReview ?? (input.severity === "ERROR" || input.severity === "CRITICAL"),
    sourceDocumentIds: input.sourceDocumentIds ?? [input.documentId]
  });
}

function extractionFields(document: DocumentContext): ExtractedFieldLike[] {
  return asFields(document.extraction?.fields);
}

function primaryDocument(documents: DocumentContext[], type: string): DocumentContext | undefined {
  return documents.find((document) => document.extraction?.documentType === type);
}

/**
 * Pure evaluation function. Tests call this directly without a database.
 */
export function evaluateConsistency(input: {
  shipment: ShipmentContext;
  documents: DocumentContext[];
}): ConsistencyFinding[] {
  const findings: ConsistencyFinding[] = [];
  const { shipment, documents } = input;

  if (documents.length === 0) return findings;

  for (const document of documents) {
    const extraction = document.extraction;
    if (!extraction) {
      add(findings, {
        code: "DOCUMENT_NOT_PROCESSED",
        severity: "WARNING",
        documentId: document.id,
        message: `Document ${document.filename} has not been processed; its contents cannot be checked.`,
        suggestedAction: "Run document processing and review the extracted fields."
      });
      continue;
    }
    if (extraction.status === "unavailable") {
      add(findings, {
        code: "EXTRACTION_UNAVAILABLE",
        severity: "WARNING",
        documentId: document.id,
        extractionId: extraction.id,
        message: `Text extraction was unavailable for ${document.filename}; no field consistency checks were possible.`,
        suggestedAction: "Upload a text-based copy or enable OCR, then process the document again."
      });
      continue;
    }
    if (extraction.status !== "completed") {
      add(findings, {
        code: "PROCESSING_FAILED",
        severity: "ERROR",
        documentId: document.id,
        extractionId: extraction.id,
        message: `Processing failed for ${document.filename}; its contents were not validated.`,
        suggestedAction: "Check the stored file and retry processing."
      });
      continue;
    }

    for (const field of extractionFields(document)) {
      if (field.validationStatus === "invalid") {
        add(findings, {
          code: "INVALID_FIELD_VALUE",
          severity: "ERROR",
          documentId: document.id,
          extractionId: extraction.id,
          field: field.key,
          observed: field.value ?? null,
          message: `${field.label ?? field.key} has an invalid value.`,
          suggestedAction: "Correct the value in the source document and upload a corrected copy."
        });
      }
      if (field.validationStatus === "missing") {
        const criticalDocument =
          extraction.documentType === "commercial_invoice" || extraction.documentType === "bill_of_lading";
        add(findings, {
          code: "REQUIRED_FIELD_MISSING",
          severity: criticalDocument ? "ERROR" : "WARNING",
          documentId: document.id,
          extractionId: extraction.id,
          field: field.key,
          expected: field.label ?? field.key,
          message: `Required field is missing: ${field.label ?? field.key}.`,
          suggestedAction: "Obtain a complete document or add the missing field through the correction workflow."
        });
      }
    }

    const reference = stringValue(fieldOf(document, "shipment_reference"));
    if (reference && normalizeText(reference) !== normalizeText(shipment.reference)) {
      add(findings, {
        code: "SHIPMENT_REFERENCE_MISMATCH",
        severity: "ERROR",
        documentId: document.id,
        extractionId: extraction.id,
        field: "shipment_reference",
        observed: reference,
        expected: shipment.reference,
        message: "The document shipment reference does not match this shipment.",
        suggestedAction: "Confirm that the document belongs to this shipment or correct the reference."
      });
    }

    const issueDate = stringValue(fieldOf(document, "issue_date"));
    if (issueDate) {
      const parsed = new Date(`${issueDate}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (parsed.getTime() > tomorrow.getTime()) {
          add(findings, {
            code: "FUTURE_DOCUMENT_DATE",
            severity: "WARNING",
            documentId: document.id,
            extractionId: extraction.id,
            field: "issue_date",
            observed: issueDate,
            message: "The document issue date is in the future.",
            suggestedAction: "Verify the date with the issuer before relying on the document."
          });
        }
      }
    }

    const hsCodes = fieldOf(document, "hs_codes");
    if (hsCodes) {
      const values = String(hsCodes.normalizedValue ?? hsCodes.value ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const invalid = values.filter((code) => !/^\d{6}(\d{2})?(\d{2})?$/.test(code) || ![6, 8, 10].includes(code.length));
      if (invalid.length > 0) {
        add(findings, {
          code: "HS_CODE_INVALID",
          severity: "ERROR",
          documentId: document.id,
          extractionId: extraction.id,
          field: "hs_codes",
          observed: invalid,
          message: "One or more HS codes are not 6, 8 or 10 digits.",
          suggestedAction: "Confirm the HS classification with a qualified customs specialist."
        });
      }
    }
  }

  const invoice = primaryDocument(documents, "commercial_invoice");
  const packingList = primaryDocument(documents, "packing_list");
  const billOfLading = primaryDocument(documents, "bill_of_lading");

  // Invoice total reconciliation.
  if (invoice) {
    const subtotal = numberValue(fieldOf(invoice, "subtotal"));
    const tax = numberValue(fieldOf(invoice, "tax"));
    const total = numberValue(fieldOf(invoice, "total"));
    if (subtotal !== null && total !== null) {
      const expected = subtotal + (tax ?? 0);
      if (Math.abs(expected - total) > CONSISTENCY_TOLERANCES.moneyAbsolute) {
        add(findings, {
          code: "TOTAL_RECONCILIATION_MISMATCH",
          severity: "ERROR",
          documentId: invoice.id,
          extractionId: invoice.extraction?.id,
          field: "total",
          observed: total,
          expected: Number(expected.toFixed(2)),
          message: "Invoice total does not reconcile with subtotal and tax.",
          suggestedAction: "Ask the issuer to confirm the invoice arithmetic and provide a corrected invoice.",
          sourceDocumentIds: [invoice.id]
        });
      }
    }

    const currency = stringValue(fieldOf(invoice, "currency"));
    if (currency && shipment.quotationCurrency && currency.toUpperCase() !== shipment.quotationCurrency.toUpperCase()) {
      add(findings, {
        code: "INVOICE_CURRENCY_MISMATCH",
        severity: "ERROR",
        documentId: invoice.id,
        extractionId: invoice.extraction?.id,
        field: "currency",
        observed: currency,
        expected: shipment.quotationCurrency,
        message: "Invoice currency differs from the recorded quotation currency.",
        suggestedAction: "Confirm the agreed currency and, if needed, issue a revised invoice or quotation."
      });
    }
  }

  // Cross-document weight and package consistency.
  const weightSources = [packingList, billOfLading]
    .filter((document): document is DocumentContext => Boolean(document))
    .map((document) => ({ document, weight: numberValue(fieldOf(document, "gross_weight_kg")) }))
    .filter((entry): entry is { document: DocumentContext; weight: number } => entry.weight !== null);

  for (let index = 1; index < weightSources.length; index += 1) {
    const left = weightSources[0];
    const right = weightSources[index];
    if (!withinWeightTolerance(left.weight, right.weight)) {
      add(findings, {
        code: "GROSS_WEIGHT_MISMATCH",
        severity: "ERROR",
        documentId: left.document.id,
        extractionId: left.document.extraction?.id,
        field: "gross_weight_kg",
        observed: left.weight,
        expected: right.weight,
        message: `Gross weight differs between ${left.document.filename} and ${right.document.filename}.`,
        suggestedAction: "Reconcile the weights with the carrier and correct the affected document.",
        sourceDocumentIds: [left.document.id, right.document.id]
      });
    }
  }

  const shipmentWeight = shipment.weightKg;
  for (const entry of weightSources) {
    if (Number.isFinite(shipmentWeight) && shipmentWeight > 0 && !withinWeightTolerance(entry.weight, shipmentWeight)) {
      add(findings, {
        code: "SHIPMENT_WEIGHT_MISMATCH",
        severity: "WARNING",
        documentId: entry.document.id,
        extractionId: entry.document.extraction?.id,
        field: "gross_weight_kg",
        observed: entry.weight,
        expected: shipmentWeight,
        message: "Document gross weight differs from the shipment record beyond tolerance.",
        suggestedAction: "Confirm the actual cargo weight and update the shipment record or document."
      });
    }
  }

  const packageSources = [packingList, billOfLading]
    .filter((document): document is DocumentContext => Boolean(document))
    .map((document) => ({ document, count: numberValue(fieldOf(document, "package_count")) }))
    .filter((entry): entry is { document: DocumentContext; count: number } => entry.count !== null);
  if (packageSources.length >= 2 && packageSources[0].count !== packageSources[1].count) {
    add(findings, {
      code: "PACKAGE_COUNT_MISMATCH",
      severity: "ERROR",
      documentId: packageSources[0].document.id,
      extractionId: packageSources[0].document.extraction?.id,
      field: "package_count",
      observed: packageSources[0].count,
      expected: packageSources[1].count,
      message: "Package count differs between documents.",
      suggestedAction: "Verify the number of packages with the shipper and align the documents.",
      sourceDocumentIds: [packageSources[0].document.id, packageSources[1].document.id]
    });
  }

  // Container consistency.
  const containerSources = [packingList, billOfLading]
    .filter((document): document is DocumentContext => Boolean(document))
    .map((document) => {
      const value = stringValue(fieldOf(document, "container_numbers"));
      const set = new Set(
        (value ?? "")
          .split(/[,\s]+/)
          .map((entry) => entry.trim().toUpperCase())
          .filter(Boolean)
      );
      return { document, set };
    })
    .filter((entry) => entry.set.size > 0);
  if (containerSources.length >= 2) {
    const left = containerSources[0];
    const right = containerSources[1];
    const onlyLeft = [...left.set].filter((value) => !right.set.has(value));
    const onlyRight = [...right.set].filter((value) => !left.set.has(value));
    if (onlyLeft.length > 0 || onlyRight.length > 0) {
      add(findings, {
        code: "CONTAINER_NUMBER_MISMATCH",
        severity: "ERROR",
        documentId: left.document.id,
        extractionId: left.document.extraction?.id,
        field: "container_numbers",
        observed: [...left.set],
        expected: [...right.set],
        message: "Container numbers differ between documents.",
        suggestedAction: "Ask the carrier to confirm the container numbers before customs filing.",
        sourceDocumentIds: [left.document.id, right.document.id]
      });
    }
  }

  // Port consistency against the recorded shipment route.
  const portChecks: Array<{
    document: DocumentContext | undefined;
    field: string;
    expected: { code: string; name: string; country: string };
    label: string;
  }> = [
    { document: billOfLading, field: "port_of_loading", expected: shipment.originPort, label: "origin" },
    { document: billOfLading, field: "port_of_discharge", expected: shipment.destinationPort, label: "destination" }
  ];
  for (const check of portChecks) {
    if (!check.document) continue;
    const value = stringValue(fieldOf(check.document, check.field));
    if (!value) continue;
    const observed = normalizeText(value);
    const accepted = [check.expected.code, check.expected.name, check.expected.country]
      .map(normalizeText)
      .filter(Boolean);
    if (!accepted.some((candidate) => observed.includes(candidate) || candidate.includes(observed))) {
      add(findings, {
        code: "PORT_MAY_MISMATCH",
        severity: "WARNING",
        documentId: check.document.id,
        extractionId: check.document.extraction?.id,
        field: check.field,
        observed: value,
        expected: `${check.expected.code} — ${check.expected.name}`,
        message: `The document ${check.label} port could not be matched to the recorded shipment route.`,
        suggestedAction: "Verify the port name/code with the carrier or forwarder before filing."
      });
    }
  }

  // Duplicate document numbers across documents of the same type.
  const numberKeys = ["invoice_number", "bl_number", "document_number"];
  for (const key of numberKeys) {
    const values = documents
      .map((document) => ({ document, value: stringValue(fieldOf(document, key)) }))
      .filter((entry): entry is { document: DocumentContext; value: string } => Boolean(entry.value));
    if (values.length >= 2 && new Set(values.map((entry) => entry.value.toUpperCase())).size === 1) {
      add(findings, {
        code: "DUPLICATE_DOCUMENT_NUMBER",
        severity: "WARNING",
        documentId: values[0].document.id,
        extractionId: values[0].document.extraction?.id,
        field: key,
        observed: values.map((entry) => entry.value),
        message: "Multiple documents carry the same document number.",
        suggestedAction: "Confirm whether this is an original plus a copy, or a duplicate upload."
      });
    }
  }

  // De-duplicate identical findings produced by multiple passes.
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}|${finding.documentId}|${finding.field ?? ""}|${JSON.stringify(finding.observed ?? null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface PersistedFindingView {
  id: string;
  code: string;
  severity: string;
  documentId: string;
  field: string | null;
  observed: unknown;
  expected: unknown;
  message: string;
  suggestedAction: string | null;
  requiresReview: boolean;
  sourceDocumentIds: unknown;
  createdAt: Date;
}

/**
 * Recompute and persist findings for one actor organization. Deleting only this
 * organization's findings keeps a party's review history from erasing the
 * owner's history.
 */
export async function recomputeAndPersistFindings(input: {
  shipment: ShipmentContext;
  documents: DocumentContext[];
  organizationId: string;
}): Promise<PersistedFindingView[]> {
  if (!prisma) return [];
  const findings = evaluateConsistency({ shipment: input.shipment, documents: input.documents });

  await prisma.$transaction(async (tx) => {
    await tx.documentFinding.deleteMany({
      where: { shipmentId: input.shipment.id, organizationId: input.organizationId }
    });
    for (const finding of findings) {
      await tx.documentFinding.create({
        data: {
          documentId: finding.documentId,
          extractionId: finding.extractionId,
          organizationId: input.organizationId,
          shipmentId: input.shipment.id,
          code: finding.code,
          severity: finding.severity,
          field: finding.field,
          observed: finding.observed ?? undefined,
          expected: finding.expected ?? undefined,
          message: finding.message,
          suggestedAction: finding.suggestedAction,
          requiresReview: finding.requiresReview,
          sourceDocumentIds: finding.sourceDocumentIds
        }
      });
    }
  });

  return prisma.documentFinding.findMany({
    where: { shipmentId: input.shipment.id, organizationId: input.organizationId },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
  }) as Promise<PersistedFindingView[]>;
}

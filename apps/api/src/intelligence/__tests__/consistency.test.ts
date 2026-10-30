import { describe, expect, it } from "vitest";
import {
  evaluateConsistency,
  type DocumentContext,
  type ExtractedFieldLike,
  type ShipmentContext
} from "../consistency.js";

function field(key: string, value: unknown, validationStatus = "present"): ExtractedFieldLike {
  return { key, value, normalizedValue: value, validationStatus, method: "test" };
}

function document(
  id: string,
  filename: string,
  type: string,
  fields: ExtractedFieldLike[]
): DocumentContext {
  return {
    id,
    filename,
    type,
    extraction: {
      id: `ext-${id}`,
      status: "completed",
      documentType: type,
      fields
    }
  };
}

function shipment(overrides: Partial<ShipmentContext> = {}): ShipmentContext {
  return {
    id: "shipment-1",
    reference: "NAQ-1001",
    organizationId: "org-1",
    status: "IN_TRANSIT",
    incoterm: "FOB",
    weightKg: 1000,
    cargoDescription: "Textiles",
    originPort: { code: "JED", name: "Jeddah", country: "SA" },
    destinationPort: { code: "RUH", name: "Riyadh", country: "SA" },
    ...overrides
  };
}

const invoiceFields = [
  field("invoice_number", "INV-1"),
  field("issue_date", "2026-10-01"),
  field("currency", "USD"),
  field("subtotal", 100),
  field("tax", 10),
  field("total", 110)
];

const packingFields = [
  field("issue_date", "2026-10-02"),
  field("package_count", 10),
  field("gross_weight_kg", 1000),
  field("container_numbers", "ABCD1234567")
];

const blFields = [
  field("bl_number", "BL-1"),
  field("port_of_loading", "Jeddah"),
  field("port_of_discharge", "Riyadh"),
  field("vessel", "NAQL STAR"),
  field("gross_weight_kg", 1000),
  field("package_count", 10),
  field("container_numbers", "ABCD1234567")
];

describe("document consistency engine", () => {
  it("returns no findings for matching documents", () => {
    const findings = evaluateConsistency({
      shipment: shipment({ quotationCurrency: "USD" }),
      documents: [
        document("invoice", "invoice.txt", "commercial_invoice", invoiceFields),
        document("packing", "packing.txt", "packing_list", packingFields),
        document("bl", "bl.txt", "bill_of_lading", blFields)
      ]
    });
    expect(findings).toEqual([]);
  });

  it("finds weight, package and container conflicts", () => {
    const findings = evaluateConsistency({
      shipment: shipment(),
      documents: [
        document("packing", "packing.txt", "packing_list", packingFields),
        document("bl", "bl.txt", "bill_of_lading", [
          ...blFields.filter((entry) => entry.key !== "gross_weight_kg" && entry.key !== "package_count" && entry.key !== "container_numbers"),
          field("gross_weight_kg", 1100),
          field("package_count", 12),
          field("container_numbers", "WXYZ7654321")
        ])
      ]
    });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("GROSS_WEIGHT_MISMATCH");
    expect(codes).toContain("PACKAGE_COUNT_MISMATCH");
    expect(codes).toContain("CONTAINER_NUMBER_MISMATCH");
    expect(findings.every((finding) => finding.sourceDocumentIds.length >= 1)).toBe(true);
  });

  it("reports missing required fields and invalid values", () => {
    const findings = evaluateConsistency({
      shipment: shipment(),
      documents: [
        document("invoice", "invoice.txt", "commercial_invoice", [
          field("invoice_number", "INV-1"),
          field("issue_date", "", "invalid"),
          field("currency", null, "missing"),
          field("total", null, "missing")
        ])
      ]
    });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("INVALID_FIELD_VALUE");
    expect(codes).toContain("REQUIRED_FIELD_MISSING");
    expect(findings.find((finding) => finding.code === "REQUIRED_FIELD_MISSING")?.requiresReview).toBe(true);
  });

  it("detects invoice total reconciliation and currency conflicts", () => {
    const findings = evaluateConsistency({
      shipment: shipment({ quotationCurrency: "EUR" }),
      documents: [
        document("invoice", "invoice.txt", "commercial_invoice", [
          ...invoiceFields.filter((entry) => entry.key !== "total"),
          field("total", 120)
        ])
      ]
    });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("TOTAL_RECONCILIATION_MISMATCH");
    expect(codes).toContain("INVOICE_CURRENCY_MISMATCH");
  });

  it("detects shipment reference and port mismatches", () => {
    const findings = evaluateConsistency({
      shipment: shipment(),
      documents: [
        document("bl", "bl.txt", "bill_of_lading", [
          ...blFields.filter((entry) => entry.key !== "port_of_loading"),
          field("shipment_reference", "NAQ-9999"),
          field("port_of_loading", "Alexandria")
        ])
      ]
    });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("SHIPMENT_REFERENCE_MISMATCH");
    expect(codes).toContain("PORT_MAY_MISMATCH");
  });

  it("respects the configured weight tolerance boundary", () => {
    const within = evaluateConsistency({
      shipment: shipment({ weightKg: 1000 }),
      documents: [
        document("packing", "packing.txt", "packing_list", packingFields),
        document("bl", "bl.txt", "bill_of_lading", [
          ...blFields.filter((entry) => entry.key !== "gross_weight_kg"),
          field("gross_weight_kg", 1020)
        ])
      ]
    });
    expect(within.map((finding) => finding.code)).not.toContain("GROSS_WEIGHT_MISMATCH");

    const outside = evaluateConsistency({
      shipment: shipment({ weightKg: 1000 }),
      documents: [
        document("packing", "packing.txt", "packing_list", packingFields),
        document("bl", "bl.txt", "bill_of_lading", [
          ...blFields.filter((entry) => entry.key !== "gross_weight_kg"),
          field("gross_weight_kg", 1021)
        ])
      ]
    });
    expect(outside.map((finding) => finding.code)).toContain("GROSS_WEIGHT_MISMATCH");
  });

  it("reports unprocessed and unavailable documents honestly", () => {
    const findings = evaluateConsistency({
      shipment: shipment(),
      documents: [
        { id: "raw", filename: "raw.pdf", type: "invoice", extraction: null },
        {
          id: "scan",
          filename: "scan.jpg",
          type: "invoice",
          extraction: { id: "ext-scan", status: "unavailable", documentType: "other", fields: [] }
        }
      ]
    });
    expect(findings.map((finding) => finding.code)).toContain("DOCUMENT_NOT_PROCESSED");
    expect(findings.map((finding) => finding.code)).toContain("EXTRACTION_UNAVAILABLE");
  });
});

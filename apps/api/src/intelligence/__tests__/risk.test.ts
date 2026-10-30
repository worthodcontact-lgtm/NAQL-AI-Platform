import { describe, expect, it } from "vitest";
import { assessRisk, estimateDelay, type RiskInput } from "../risk.js";

function input(overrides: Partial<RiskInput> & { createdAt?: string } = {}): RiskInput & { createdAt?: string } {
  return {
    status: "IN_TRANSIT",
    mode: "SEA",
    incoterm: "FOB",
    weightKg: 1000,
    cargoDescription: "Textiles",
    originPort: { code: "JED", name: "Jeddah", country: "SA" },
    destinationPort: { code: "RUH", name: "Riyadh", country: "SA" },
    milestones: [
      { code: "BOOKED", status: "done", occurredAt: "2026-10-01" },
      { code: "DEPARTED", status: "done", occurredAt: "2026-10-03" }
    ],
    documents: [
      { id: "invoice", type: "commercial_invoice", filename: "invoice.txt", extractionStatus: "completed", documentType: "commercial_invoice" },
      { id: "packing", type: "packing_list", filename: "packing.txt", extractionStatus: "completed", documentType: "packing_list" },
      { id: "bl", type: "bill_of_lading", filename: "bl.txt", extractionStatus: "completed", documentType: "bill_of_lading" }
    ],
    findings: [],
    ...overrides
  };
}

describe("shipment risk baseline", () => {
  it("keeps a complete in-transit shipment at low risk", () => {
    const result = assessRisk(input());
    expect(result.category).toBe("low");
    expect(result.score).toBe(0);
    expect(result.factors).toEqual([]);
    expect(result.dataCompleteness).toBeGreaterThanOrEqual(80);
  });

  it("adds a documentary factor for missing required documents", () => {
    const result = assessRisk(input({ documents: [] }));
    expect(result.score).toBeGreaterThanOrEqual(36);
    expect(result.factors.map((factor) => factor.code)).toContain("MISSING_REQUIRED_DOCUMENTS");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("scores an exception status and missing milestone transparently", () => {
    const result = assessRisk(
      input({
        status: "EXCEPTION",
        documents: [],
        milestones: [{ code: "BOOKED", status: "done" }]
      })
    );
    expect(result.category).toBe("critical");
    expect(result.factors.map((factor) => factor.code)).toContain("SHIPMENT_EXCEPTION");
    expect(result.factors.map((factor) => factor.code)).toContain("ARRIVAL_MILESTONE_MISSING");
  });

  it("turns document findings into scored consistency factors", () => {
    const result = assessRisk(
      input({
        findings: [
          { code: "GROSS_WEIGHT_MISMATCH", severity: "ERROR", documentId: "bl" },
          { code: "PORT_MAY_MISMATCH", severity: "WARNING", documentId: "bl" }
        ]
      })
    );
    expect(result.factors.map((factor) => factor.code)).toContain("DOCUMENT_FINDINGS");
    expect(result.score).toBeGreaterThanOrEqual(14);
  });

  it("reports missing route and weight as data-quality factors", () => {
    const result = assessRisk(input({ originPort: null, destinationPort: null, weightKg: 0 }));
    const codes = result.factors.map((factor) => factor.code);
    expect(codes).toContain("ROUTE_INCOMPLETE");
    expect(codes).toContain("CARGO_WEIGHT_MISSING");
  });
});

describe("delay baseline", () => {
  it("returns insufficient data instead of inventing an ETA", () => {
    const result = estimateDelay(input({ createdAt: "2026-10-01T00:00:00.000Z" }));
    expect(result.status).toBe("insufficient_data");
    expect(result.estimatedDelayDays).toBeNull();
    expect(result.method).toBe("deterministic-milestones-v1");
    expect(result.factors.map((factor) => factor.code)).toContain("NO_PLANNED_ARRIVAL_DATE");
  });

  it("reports observed transit duration when departure and arrival are recorded", () => {
    const result = estimateDelay(
      input({
        status: "ARRIVED",
        milestones: [
          { code: "DEPARTED", status: "done", occurredAt: "2026-10-01T00:00:00.000Z" },
          { code: "ARRIVED", status: "done", occurredAt: "2026-10-11T00:00:00.000Z" }
        ]
      })
    );
    expect(result.status).toBe("observed");
    expect(result.estimatedDelayDays).toBeNull();
    expect(result.factors[0].evidence).toMatchObject({ days: 10 });
  });
});

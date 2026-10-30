import { describe, it, expect } from "vitest";
import { assessLandedCost, calculateLandedCost } from "../landed-cost.js";

describe("calculateLandedCost", () => {
  it("calculates itemized total", () => {
    const result = calculateLandedCost({
      productCost: 1000,
      freight: 200,
      insurance: 30,
      customsDutyRate: 0.05,
      taxRate: 0.15,
      fees: 20,
      currency: "USD"
    });
    expect(result.customsDuty).toBe(50);
    expect(result.taxes).toBe(195);
    expect(result.total).toBe(1495);
    expect(result.status).toBe("estimated");
    expect(result.verified).toBe(false);
    expect(result.provenance.freight.source).toBe("user_provided");
    expect(result.provenance.freight.inclusion).toBe("included");
    expect(result.provenance.customsDuty.source).toBe("calculated");
    expect(result.provenance.total.assumptions[0]).toContain("unknown or omitted");
  });

  it("does not turn unknown charges or missing rates into zero", () => {
    const result = assessLandedCost({ productCost: 1000, freight: 200, currency: "USD" });
    expect(result.status).toBe("incomplete");
    expect(result.total).toBeNull();
    expect(result).toMatchObject({ unknownComponents: expect.arrayContaining(["insurance", "customsDuty", "taxes", "fees"]) });
    expect(result.provenance.fees.amount).toBeNull();
    expect(result.provenance.fees.inclusion).toBe("unknown");
    expect(result.provenance.total.source).toBe("unknown");
  });

  it("keeps known user-entered fees but refuses a total when a rate is missing", () => {
    const result = assessLandedCost({
      productCost: 1000, freight: 200, insurance: 30, taxRate: 0.15, fees: 20, currency: "USD"
    });
    expect(result.status).toBe("incomplete");
    expect(result.total).toBeNull();
    expect(result.provenance.fees.amount).toBe(20);
    expect(result.provenance.fees.inclusion).toBe("included");
    expect(result).toMatchObject({ unknownComponents: expect.arrayContaining(["customsDuty"]) });
  });
});

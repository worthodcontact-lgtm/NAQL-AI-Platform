import { describe, it, expect } from "vitest";
import { calculateLandedCost } from "../landed-cost.js";

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
  });
});

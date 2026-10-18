import { z } from "zod";

export interface LandedCostInput {
  productCost: number;
  freight: number;
  insurance: number;
  customsDutyRate: number;
  taxRate: number;
  fees: number;
  currency: string;
}

export interface LandedCostResult {
  currency: string;
  productCost: number;
  freight: number;
  insurance: number;
  customsDuty: number;
  taxes: number;
  fees: number;
  total: number;
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  const customsDuty = round(input.productCost * input.customsDutyRate);
  const subtotalBeforeTax = input.productCost + input.freight + input.insurance + customsDuty + input.fees;
  const taxes = round(subtotalBeforeTax * input.taxRate);
  const total = round(subtotalBeforeTax + taxes);
  return {
    currency: input.currency,
    productCost: input.productCost,
    freight: input.freight,
    insurance: input.insurance,
    customsDuty,
    taxes,
    fees: input.fees,
    total
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

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
  status: "estimated";
  verified: false;
  provenance: Record<string, { source: "user_provided" | "calculated"; amount: number; currency: string; verified: false; inclusion: "included"; effectiveAt: string; assumptions: string[] }>;
}

export interface LandedCostAssessmentInput extends Partial<Omit<LandedCostInput, "currency">> {
  currency: string;
}

export interface IncompleteLandedCostResult {
  currency: string;
  productCost: number | null;
  freight: number | null;
  insurance: number | null;
  customsDuty: number | null;
  taxes: number | null;
  fees: number | null;
  total: null;
  status: "incomplete";
  verified: false;
  unknownComponents: string[];
  provenance: Record<string, { source: "user_provided" | "calculated" | "unknown"; amount: number | null; currency: string; verified: false; inclusion: "included" | "unknown"; effectiveAt: string; assumptions: string[] }>;
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  const effectiveAt = new Date().toISOString();
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
    total,
    status: "estimated",
    verified: false,
    provenance: {
      productCost: component(input.productCost, input.currency, "user_provided", effectiveAt, "Amount entered by the user; no provider offer was verified."),
      freight: component(input.freight, input.currency, "user_provided", effectiveAt, "Amount entered by the user; no provider offer was verified."),
      insurance: component(input.insurance, input.currency, "user_provided", effectiveAt, "Amount entered by the user; no insurance quote was verified."),
      customsDuty: component(customsDuty, input.currency, "calculated", effectiveAt, `Calculated using the user-provided duty rate ${input.customsDutyRate}; no tariff source was verified.`),
      taxes: component(taxes, input.currency, "calculated", effectiveAt, `Calculated using the user-provided tax rate ${input.taxRate}; tax treatment was not verified.`),
      fees: component(input.fees, input.currency, "user_provided", effectiveAt, "Amount entered by the user; fees may be incomplete."),
      total: component(total, input.currency, "calculated", effectiveAt, "Sum of the supplied and calculated components; excludes any unknown or omitted charges.")
    }
  };
}

/** Missing cost inputs remain unknown; they are never silently treated as zero. */
export function assessLandedCost(input: LandedCostAssessmentInput): LandedCostResult | IncompleteLandedCostResult {
  const required: Array<keyof Omit<LandedCostInput, "currency">> = [
    "productCost", "freight", "insurance", "customsDutyRate", "taxRate", "fees"
  ];
  const missing = required.filter((key) => input[key] === undefined);
  if (missing.length === 0) return calculateLandedCost(input as LandedCostInput);

  const effectiveAt = new Date().toISOString();
  const amount = (key: "productCost" | "freight" | "insurance" | "fees") => input[key] ?? null;
  const customsDuty = input.productCost !== undefined && input.customsDutyRate !== undefined
    ? round(input.productCost * input.customsDutyRate)
    : null;
  const taxBaseKnown = input.productCost !== undefined && input.freight !== undefined && input.insurance !== undefined && input.fees !== undefined && customsDuty !== null;
  const taxes = taxBaseKnown && input.taxRate !== undefined
    ? round((input.productCost! + input.freight! + input.insurance! + customsDuty + input.fees!) * input.taxRate)
    : null;
  const unknownComponents = [
    ...(input.productCost === undefined ? ["productCost"] : []),
    ...(input.freight === undefined ? ["freight"] : []),
    ...(input.insurance === undefined ? ["insurance"] : []),
    ...(input.customsDutyRate === undefined || input.productCost === undefined ? ["customsDuty"] : []),
    ...(input.taxRate === undefined || !taxBaseKnown ? ["taxes"] : []),
    ...(input.fees === undefined ? ["fees"] : [])
  ];
  const sourceFor = (key: string): "user_provided" | "calculated" | "unknown" => {
    if (key === "customsDuty" || key === "taxes") return unknownComponents.includes(key) ? "unknown" : "calculated";
    return input[key as keyof LandedCostAssessmentInput] === undefined ? "unknown" : "user_provided";
  };
  const prov = (key: string, value: number | null, assumption: string) => ({
    amount: value,
    currency: input.currency,
    source: sourceFor(key),
    verified: false as const,
    inclusion: value === null ? "unknown" as const : "included" as const,
    effectiveAt,
    assumptions: [assumption]
  });
  return {
    currency: input.currency,
    productCost: amount("productCost"),
    freight: amount("freight"),
    insurance: amount("insurance"),
    customsDuty,
    taxes,
    fees: amount("fees"),
    total: null,
    status: "incomplete",
    verified: false,
    unknownComponents,
    provenance: {
      productCost: prov("productCost", amount("productCost"), "User-entered amount; no provider offer was verified."),
      freight: prov("freight", amount("freight"), "User-entered amount; no provider offer was verified."),
      insurance: prov("insurance", amount("insurance"), "Unknown until entered; excluded from any total."),
      customsDuty: prov("customsDuty", customsDuty, "Requires both a product value and a user-provided duty rate; no tariff source is connected."),
      taxes: prov("taxes", taxes, "Requires a complete tax base and user-provided rate; tax treatment is not verified."),
      fees: prov("fees", amount("fees"), "Unknown until entered; do not assume no additional fees."),
      total: prov("total", null, "Not calculated because required components or rates are unknown.")
    }
  };
}

function component(amount: number, currency: string, source: "user_provided" | "calculated", effectiveAt: string, assumption: string) {
  return { amount, currency, source, verified: false as const, inclusion: "included" as const, effectiveAt, assumptions: [assumption] };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

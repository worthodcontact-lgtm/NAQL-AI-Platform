import { prisma } from "../db.js";

/**
 * Transparent shipment risk and delay baselines.
 *
 * These are operational indicators built only from recorded shipment data.
 * They do not claim live weather, congestion, carrier performance or customs
 * status, none of which is available in this environment.
 */

export const RISK_RULE_VERSION = "risk-v1-2026-10-21";
export const DELAY_RULE_VERSION = "delay-v1-2026-10-21";

export type RiskCategory = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  code: string;
  label: string;
  weight: number;
  evidence: unknown;
  dimension: "documents" | "consistency" | "schedule" | "data_quality" | "status" | "route";
}

export interface RiskInput {
  status: string;
  mode: string;
  incoterm: string;
  weightKg: number;
  volumeCbm?: number | null;
  cargoDescription: string;
  originPort?: { code: string; name: string; country: string } | null;
  destinationPort?: { code: string; name: string; country: string } | null;
  milestones: Array<{ code: string; status: string; occurredAt?: Date | string | null }>;
  documents: Array<{
    id: string;
    type: string;
    filename: string;
    extractionStatus?: string | null;
    documentType?: string | null;
  }>;
  findings: Array<{ code: string; severity: string; documentId: string }>;
}

export interface RiskResult {
  score: number;
  category: RiskCategory;
  method: string;
  ruleVersion: string;
  dataCompleteness: number;
  factors: RiskFactor[];
  recommendations: string[];
}

const REQUIRED_TYPES_BY_STATUS: Record<string, string[]> = {
  DRAFT: [],
  QUOTATION_REQUESTED: [],
  QUOTED: [],
  BOOKED: ["commercial_invoice", "packing_list"],
  IN_TRANSIT: ["commercial_invoice", "packing_list", "bill_of_lading"],
  ARRIVED: ["commercial_invoice", "packing_list", "bill_of_lading"],
  CUSTOMS_CLEARANCE: ["commercial_invoice", "packing_list", "bill_of_lading", "customs_document"],
  DELIVERED: ["commercial_invoice", "packing_list", "bill_of_lading"],
  EXCEPTION: ["commercial_invoice", "packing_list", "bill_of_lading"],
  CANCELLED: []
};

function categoryFor(score: number): RiskCategory {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function completeness(input: RiskInput): number {
  let points = 0;
  const total = 10;
  if (input.originPort) points += 1;
  if (input.destinationPort) points += 1;
  if (input.mode) points += 1;
  if (input.incoterm) points += 1;
  if (Number.isFinite(input.weightKg) && input.weightKg > 0) points += 1;
  if (input.cargoDescription.trim().length >= 3) points += 1;
  if (input.milestones.length > 0) points += 1;
  if (input.documents.length > 0) points += 1;
  if (input.documents.some((document) => document.extractionStatus === "completed")) points += 1;
  if (input.documents.length > 0 && input.documents.every((document) => document.extractionStatus)) points += 1;
  return Math.round((points / total) * 100);
}

function milestoneDone(input: RiskInput, code: string): boolean {
  return input.milestones.some((milestone) => milestone.code === code && milestone.status === "done");
}

/** Pure scoring function, unit-testable without a database. */
export function assessRisk(input: RiskInput): RiskResult {
  const factors: RiskFactor[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const requiredTypes = REQUIRED_TYPES_BY_STATUS[input.status] ?? [];
  const documentTypes = new Set(
    input.documents.map((document) => document.documentType ?? document.type).filter(Boolean)
  );
  const missingTypes = requiredTypes.filter((type) => !documentTypes.has(type));
  if (missingTypes.length > 0) {
    const weight = Math.min(36, missingTypes.length * 12);
    score += weight;
    factors.push({
      code: "MISSING_REQUIRED_DOCUMENTS",
      label: "Required shipping documents are missing",
      weight,
      evidence: { missingTypes, status: input.status },
      dimension: "documents"
    });
    recommendations.push("Request the missing shipping documents before the next operational milestone.");
  }

  const unprocessed = input.documents.filter((document) => !document.extractionStatus || document.extractionStatus !== "completed");
  if (unprocessed.length > 0) {
    const weight = Math.min(15, unprocessed.length * 5);
    score += weight;
    factors.push({
      code: "DOCUMENTS_NOT_PROCESSED",
      label: "One or more documents have no completed extraction",
      weight,
      evidence: { documentIds: unprocessed.map((document) => document.id) },
      dimension: "documents"
    });
    recommendations.push("Process uploaded documents so their fields can be reviewed.");
  }

  const severityCounts = input.findings.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;
    return counts;
  }, {});
  const findingWeight = Math.min(
    45,
    (severityCounts.CRITICAL ?? 0) * 25 + (severityCounts.ERROR ?? 0) * 10 + (severityCounts.WARNING ?? 0) * 4
  );
  if (findingWeight > 0) {
    score += findingWeight;
    factors.push({
      code: "DOCUMENT_FINDINGS",
      label: "Document consistency findings need review",
      weight: findingWeight,
      evidence: severityCounts,
      dimension: "consistency"
    });
    recommendations.push("Review document consistency findings and correct confirmed contradictions.");
  }

  if (input.status === "EXCEPTION") {
    score += 30;
    factors.push({
      code: "SHIPMENT_EXCEPTION",
      label: "Shipment is marked as an exception",
      weight: 30,
      evidence: { status: input.status },
      dimension: "status"
    });
    recommendations.push("Review the exception reason and assign an operational owner.");
  }

  if (input.status === "IN_TRANSIT" && !milestoneDone(input, "DEPARTED")) {
    score += 15;
    factors.push({
      code: "DEPARTURE_MILESTONE_MISSING",
      label: "Shipment is in transit but the departure milestone is not recorded",
      weight: 15,
      evidence: { milestone: "DEPARTED", status: "pending" },
      dimension: "schedule"
    });
    recommendations.push("Confirm the actual departure date and record the milestone.");
  }

  if (["ARRIVED", "CUSTOMS_CLEARANCE", "DELIVERED", "EXCEPTION"].includes(input.status) && !milestoneDone(input, "ARRIVED")) {
    score += 20;
    factors.push({
      code: "ARRIVAL_MILESTONE_MISSING",
      label: "Arrival is not recorded for an advanced shipment",
      weight: 20,
      evidence: { milestone: "ARRIVED", status: "pending" },
      dimension: "schedule"
    });
    recommendations.push("Record the arrival milestone or correct the shipment status.");
  }

  if (input.status === "DELIVERED" && !milestoneDone(input, "DELIVERED")) {
    score += 15;
    factors.push({
      code: "DELIVERY_MILESTONE_MISSING",
      label: "Shipment is delivered but the delivery milestone is not recorded",
      weight: 15,
      evidence: { milestone: "DELIVERED", status: "pending" },
      dimension: "schedule"
    });
    recommendations.push("Record proof of delivery and update the milestone.");
  }

  if (!input.originPort || !input.destinationPort) {
    score += 10;
    factors.push({
      code: "ROUTE_INCOMPLETE",
      label: "Route information is incomplete",
      weight: 10,
      evidence: {
        originPort: input.originPort?.code ?? null,
        destinationPort: input.destinationPort?.code ?? null
      },
      dimension: "route"
    });
    recommendations.push("Confirm the origin and destination ports on the shipment.");
  }

  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    score += 8;
    factors.push({
      code: "CARGO_WEIGHT_MISSING",
      label: "Cargo weight is missing or invalid",
      weight: 8,
      evidence: { weightKg: input.weightKg },
      dimension: "data_quality"
    });
    recommendations.push("Enter the verified cargo weight.");
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: normalizedScore,
    category: categoryFor(normalizedScore),
    method: "deterministic-rules-v1",
    ruleVersion: RISK_RULE_VERSION,
    dataCompleteness: completeness(input),
    factors,
    recommendations
  };
}

export interface DelayResult {
  status: "insufficient_data" | "observed";
  estimatedDelayDays: number | null;
  minDelayDays: number | null;
  maxDelayDays: number | null;
  riskCategory: RiskCategory;
  method: string;
  ruleVersion: string;
  dataCompleteness: number;
  factors: Array<{ code: string; label: string; evidence: unknown }>;
  recommendations: string[];
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 86_400_000) * 10) / 10;
}

/**
 * There is no planned ETA field in the current schema, so a delay in days must
 * not be invented. We can report observed transit duration once departure and
 * arrival are both recorded, otherwise the honest result is insufficient data.
 */
export function estimateDelay(input: RiskInput & { createdAt?: Date | string | null }): DelayResult {
  const factors: DelayResult["factors"] = [];
  const recommendations: string[] = [];
  const risk = assessRisk(input);
  const completenessValue = risk.dataCompleteness;

  const departed = input.milestones.find((milestone) => milestone.code === "DEPARTED" && milestone.status === "done" && milestone.occurredAt);
  const arrived = input.milestones.find(
    (milestone) => (milestone.code === "ARRIVED" || milestone.code === "DELIVERED") && milestone.status === "done" && milestone.occurredAt
  );

  if (departed?.occurredAt && arrived?.occurredAt) {
    const departure = new Date(departed.occurredAt);
    const arrival = new Date(arrived.occurredAt);
    const observedDays = daysBetween(departure, arrival);
    factors.push({
      code: "OBSERVED_TRANSIT_DURATION",
      label: "Observed transit duration from recorded milestones",
      evidence: { departure: departure.toISOString(), arrival: arrival.toISOString(), days: observedDays }
    });
    recommendations.push("Use the observed duration as a baseline for future quotes on this route; no planned ETA was recorded for this shipment.");
    return {
      status: "observed",
      estimatedDelayDays: null,
      minDelayDays: null,
      maxDelayDays: null,
      riskCategory: risk.category,
      method: "deterministic-milestones-v1",
      ruleVersion: DELAY_RULE_VERSION,
      dataCompleteness: completenessValue,
      factors,
      recommendations
    };
  }

  factors.push({
    code: "NO_PLANNED_ARRIVAL_DATE",
    label: "No planned arrival/ETA is recorded for this shipment",
    evidence: { status: input.status }
  });
  if (input.createdAt) {
    factors.push({
      code: "SHIPMENT_AGE",
      label: "Age since shipment creation",
      evidence: { createdAt: new Date(input.createdAt).toISOString(), days: daysBetween(new Date(input.createdAt), new Date()) }
    });
  }
  if (input.status === "EXCEPTION") {
    factors.push({ code: "EXCEPTION_STATUS", label: "Shipment is in exception status", evidence: { status: input.status } });
  }
  recommendations.push("Record a planned arrival date before relying on a delay estimate.");
  recommendations.push("Continue monitoring milestones; the current risk category is an operational indicator, not a trained prediction.");

  return {
    status: "insufficient_data",
    estimatedDelayDays: null,
    minDelayDays: null,
    maxDelayDays: null,
    riskCategory: risk.category,
    method: "deterministic-milestones-v1",
    ruleVersion: DELAY_RULE_VERSION,
    dataCompleteness: completenessValue,
    factors,
    recommendations
  };
}

export async function assessShipment(input: {
  shipmentId: string;
  organizationId: string;
}): Promise<{
  shipment: { id: string; reference: string; status: string };
  risk: RiskResult;
  delay: DelayResult;
  findings: Array<{ id: string; code: string; severity: string; message: string; documentId: string }>;
  documents: Array<{ id: string; filename: string; type: string; extractionStatus: string | null; documentType: string | null }>;
} | null> {
  if (!prisma) return null;

  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      originPort: { select: { code: true, name: true, country: true } },
      destinationPort: { select: { code: true, name: true, country: true } },
      milestones: true,
      documents: {
        include: { extraction: { select: { status: true, documentType: true } } },
        orderBy: { uploadedAt: "asc" }
      },
      quotationRequests: {
        include: { offers: { select: { currency: true }, take: 1 } },
        take: 1
      }
    }
  });
  if (!shipment) return null;

  let canViewDocuments = shipment.organizationId === input.organizationId;
  if (!canViewDocuments) {
    const party = await prisma.shipmentParty.findFirst({
      where: {
        shipmentId: shipment.id,
        canView: true,
        company: { organizationId: input.organizationId }
      },
      select: { canViewDocuments: true, canViewFinancials: true }
    });
    if (!party) return null;
    canViewDocuments = party.canViewDocuments;
  }
  // A party that cannot see the shipment documents must not receive a risk
  // score that treats every document as missing.
  if (!canViewDocuments) return null;

  const visibleDocuments = canViewDocuments
    ? shipment.documents.filter(
        (document) =>
          shipment.organizationId === input.organizationId ||
          document.visibility === "shipment" ||
          document.uploadedByOrganizationId === input.organizationId
      )
    : [];

  const findings = await prisma.documentFinding.findMany({
    where: { shipmentId: shipment.id, organizationId: input.organizationId },
    orderBy: { createdAt: "desc" }
  });

  const riskInput: RiskInput = {
    status: shipment.status,
    mode: shipment.mode,
    incoterm: shipment.incoterm,
    weightKg: Number(shipment.weightKg),
    volumeCbm: shipment.volumeCbm === null ? null : Number(shipment.volumeCbm),
    cargoDescription: shipment.cargoDescription,
    originPort: shipment.originPort,
    destinationPort: shipment.destinationPort,
    milestones: shipment.milestones,
    documents: visibleDocuments.map((document) => ({
      id: document.id,
      type: document.type,
      filename: document.filename,
      extractionStatus: document.extraction?.status ?? null,
      documentType: document.extraction?.documentType ?? null
    })),
    findings: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      documentId: finding.documentId
    }))
  };

  const risk = assessRisk(riskInput);
  const delay = estimateDelay({ ...riskInput, createdAt: shipment.createdAt });

  await prisma.$transaction([
    prisma.shipmentRiskAssessment.create({
      data: {
        shipmentId: shipment.id,
        organizationId: input.organizationId,
        score: risk.score,
        category: risk.category,
        method: risk.method,
        ruleVersion: risk.ruleVersion,
        dataCompleteness: risk.dataCompleteness,
        factors: risk.factors as any,
        recommendations: risk.recommendations as any
      }
    }),
    prisma.shipmentDelayEstimate.create({
      data: {
        shipmentId: shipment.id,
        organizationId: input.organizationId,
        status: delay.status,
        estimatedDelayDays: delay.estimatedDelayDays,
        minDelayDays: delay.minDelayDays,
        maxDelayDays: delay.maxDelayDays,
        riskCategory: delay.riskCategory,
        method: delay.method,
        ruleVersion: delay.ruleVersion,
        dataCompleteness: delay.dataCompleteness,
        factors: delay.factors as any,
        recommendations: delay.recommendations as any
      }
    })
  ]);

  return {
    shipment: { id: shipment.id, reference: shipment.reference, status: shipment.status },
    risk,
    delay,
    findings: findings.map((finding) => ({
      id: finding.id,
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      documentId: finding.documentId
    })),
    documents: riskInput.documents.map((document) => ({
      id: document.id,
      filename: document.filename,
      type: document.type,
      extractionStatus: document.extractionStatus ?? null,
      documentType: document.documentType ?? null
    }))
  };
}

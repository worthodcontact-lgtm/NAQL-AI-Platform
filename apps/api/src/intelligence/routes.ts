import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { getAuthUser } from "../auth/routes.js";
import { prisma } from "../db.js";
import { loadShipmentAccess, partyAllows } from "../shipments/access.js";
import { requireCompanyPermission } from "../auth/company.js";
import { notify } from "../notifications/service.js";
import {
  CONSISTENCY_RULE_VERSION,
  evaluateConsistency,
  recomputeAndPersistFindings,
  type DocumentContext,
  type ShipmentContext
} from "./consistency.js";
import { assessShipment } from "./risk.js";

async function notifySevereFindings(input: {
  organizationId: string;
  shipmentId: string;
  shipmentReference: string;
  recipientUserIds?: string[];
  findings: any[];
}) {
  const severe = input.findings.filter(
    (finding) => finding.severity === "ERROR" || finding.severity === "CRITICAL"
  );
  if (severe.length === 0) return;
  const digest = createHash("sha1")
    .update(severe.map((finding) => finding.id).sort().join(","))
    .digest("hex")
    .slice(0, 16);
  await notify({
    organizationId: input.organizationId,
    type: "DOCUMENT_FINDINGS",
    title: "تعارض في وثائق الشحنة",
    body: `${input.shipmentReference}: ${severe.length} ملاحظة تتطلب المراجعة.`,
    dedupeKey: `consistency:${input.shipmentId}:${digest}`,
    entityType: "Shipment",
    entityId: input.shipmentId,
    severity: "error",
    recipientUserIds: input.recipientUserIds
  });
}

async function notifyHighRisk(input: {
  organizationId: string;
  shipment: { id: string; reference: string; status: string };
  risk: { score: number; category: string; ruleVersion: string; factors: Array<{ code: string; label: string }> };
}) {
  if (input.risk.category !== "high" && input.risk.category !== "critical") return;
  const topFactors = input.risk.factors
    .slice(0, 3)
    .map((factor) => factor.label)
    .join("; ");
  await notify({
    organizationId: input.organizationId,
    type: "RISK_ALERT",
    title: `تنبيه مخاطر ${input.risk.category === "critical" ? "حرج" : "مرتفع"}`,
    body: `${input.shipment.reference}: درجة ${input.risk.score}/100. ${topFactors || "راجع عوامل المخاطر."}`,
    dedupeKey: `risk-alert:${input.shipment.id}:${input.risk.ruleVersion}:${input.risk.category}`,
    entityType: "Shipment",
    entityId: input.shipment.id,
    severity: input.risk.category === "critical" ? "critical" : "error"
  });
}

function canSeeDocument(
  access: NonNullable<Awaited<ReturnType<typeof loadShipmentAccess>>>,
  document: { visibility: string; uploadedByOrganizationId?: string | null },
  organizationId: string
): boolean {
  if (access.isOwner) return true;
  if (!partyAllows(access, "viewDocuments")) return false;
  return document.visibility === "shipment" || document.uploadedByOrganizationId === organizationId;
}

async function loadConsistencyContext(input: {
  shipmentId: string;
  user: ReturnType<typeof getAuthUser>;
}) {
  if (!prisma) return null;
  const access = await loadShipmentAccess(input.user, input.shipmentId);
  if (!access || !partyAllows(access, "view")) return null;

  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId },
    include: {
      originPort: { select: { code: true, name: true, country: true } },
      destinationPort: { select: { code: true, name: true, country: true } },
      milestones: true,
      documents: {
        include: { extraction: true },
        orderBy: { uploadedAt: "asc" }
      },
      quotationRequests: {
        include: { offers: { select: { currency: true }, take: 1 } },
        take: 1
      }
    }
  });
  if (!shipment) return null;

  const documents: DocumentContext[] = shipment.documents
    .filter((document) => canSeeDocument(access, document, input.user.organizationId))
    .map((document) => ({
      id: document.id,
      filename: document.filename,
      type: document.type,
      extraction: document.extraction
        ? {
            id: document.extraction.id,
            status: document.extraction.status,
            documentType: document.extraction.documentType,
            fields: document.extraction.fields
          }
        : null
    }));

  const canSeeFinancials = access.isOwner || partyAllows(access, "viewFinancials");
  const context: ShipmentContext = {
    id: shipment.id,
    reference: shipment.reference,
    organizationId: shipment.organizationId,
    status: shipment.status,
    incoterm: shipment.incoterm,
    weightKg: Number(shipment.weightKg),
    volumeCbm: shipment.volumeCbm === null ? null : Number(shipment.volumeCbm),
    cargoDescription: shipment.cargoDescription,
    originPort: shipment.originPort,
    destinationPort: shipment.destinationPort,
    quotationCurrency: canSeeFinancials ? shipment.quotationRequests[0]?.offers[0]?.currency ?? null : null,
    milestones: shipment.milestones
  };

  return { access, shipment, documents, context };
}

function serializeFinding(finding: any) {
  return {
    id: finding.id,
    code: finding.code,
    severity: finding.severity,
    documentId: finding.documentId,
    field: finding.field,
    observed: finding.observed,
    expected: finding.expected,
    message: finding.message,
    suggestedAction: finding.suggestedAction,
    requiresReview: finding.requiresReview,
    sourceDocumentIds: finding.sourceDocumentIds,
    createdAt: finding.createdAt
  };
}

export async function registerIntelligenceRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/shipments/:id/consistency",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.documents.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const loaded = await loadConsistencyContext({ shipmentId: id, user });
      if (!loaded) return reply.code(404).send({ error: "Not found" });

      if (prisma) {
        await recomputeAndPersistFindings({
          shipment: loaded.context,
          documents: loaded.documents,
          organizationId: user.organizationId
        });
      }
      const findings = prisma
        ? await prisma.documentFinding.findMany({
            where: { shipmentId: id, organizationId: user.organizationId },
            orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
          })
        : evaluateConsistency({ shipment: loaded.context, documents: loaded.documents });

      if (prisma) {
        await notifySevereFindings({
          organizationId: user.organizationId,
          shipmentId: id,
          shipmentReference: loaded.context.reference,
          recipientUserIds: [user.id],
          findings
        });
      }

      return {
        shipmentId: id,
        ruleVersion: CONSISTENCY_RULE_VERSION,
        documentsChecked: loaded.documents.length,
        findings: findings.map(serializeFinding)
      };
    }
  );

  app.get(
    "/api/v1/shipments/:id/consistency",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.documents.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const loaded = await loadConsistencyContext({ shipmentId: id, user });
      if (!loaded) return reply.code(404).send({ error: "Not found" });
      if (!prisma) return { shipmentId: id, findings: [], persistence: "unavailable" };
      const findings = await prisma.documentFinding.findMany({
        where: { shipmentId: id, organizationId: user.organizationId },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
      });
      return { shipmentId: id, findings: findings.map(serializeFinding) };
    }
  );

  app.get(
    "/api/v1/shipments/:id/intelligence",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const result = await assessShipment({ shipmentId: id, organizationId: user.organizationId });
      if (!result) return reply.code(404).send({ error: "Not found" });
      return {
        ...result,
        limitations: [
          "Risk and delay are operational indicators derived from recorded data.",
          "No live weather, port congestion, carrier performance or customs status source is configured.",
          "A delay in days is not estimated unless a planned ETA is recorded; this schema currently has no ETA field."
        ]
      };
    }
  );

  app.post(
    "/api/v1/shipments/:id/intelligence/refresh",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const result = await assessShipment({ shipmentId: id, organizationId: user.organizationId });
      if (!result) return reply.code(404).send({ error: "Not found" });
      await notifyHighRisk({
        organizationId: user.organizationId,
        shipment: result.shipment,
        risk: result.risk
      });
      return result;
    }
  );

  app.get(
    "/api/v1/shipments/:id/intelligence/history",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      if (!prisma) return { risk: [], delay: [], persistence: "unavailable" };
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const access = await loadShipmentAccess(user, id);
      if (!access || !partyAllows(access, "view")) return reply.code(404).send({ error: "Not found" });

      const [risk, delay] = await Promise.all([
        prisma.shipmentRiskAssessment.findMany({
          where: { shipmentId: id, organizationId: user.organizationId },
          orderBy: { createdAt: "desc" },
          take: 20
        }),
        prisma.shipmentDelayEstimate.findMany({
          where: { shipmentId: id, organizationId: user.organizationId },
          orderBy: { computedAt: "desc" },
          take: 20
        })
      ]);
      return { risk, delay };
    }
  );

  // Accept the older path used by early Phase 2 clients for consistency.
  app.post(
    "/api/v1/documents/consistency/:shipmentId",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.documents.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { shipmentId } = request.params as { shipmentId: string };
      const loaded = await loadConsistencyContext({ shipmentId, user });
      if (!loaded) return reply.code(404).send({ error: "Not found" });
      if (prisma) {
        await recomputeAndPersistFindings({
          shipment: loaded.context,
          documents: loaded.documents,
          organizationId: user.organizationId
        });
      }
      const findings = prisma
        ? await prisma.documentFinding.findMany({
            where: { shipmentId, organizationId: user.organizationId },
            orderBy: [{ severity: "desc" }, { createdAt: "desc" }]
          })
        : evaluateConsistency({ shipment: loaded.context, documents: loaded.documents });
      if (prisma) {
        await notifySevereFindings({
          organizationId: user.organizationId,
          shipmentId,
          shipmentReference: loaded.context.reference,
          recipientUserIds: [user.id],
          findings
        });
      }
      return { shipmentId, findings: findings.map(serializeFinding) };
    }
  );
}

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { recordAudit } from "../audit/log.js";
import { requireCompanyPermission } from "../auth/company.js";
import { loadShipmentAccess, partyAllows } from "./access.js";
import {
  SHIPMENT_EVENT_DEFINITIONS,
  validateEventTransition,
  type ShipmentEventCode
} from "./state.js";
import { notify } from "../notifications/service.js";

const EVENT_CODES = Object.keys(SHIPMENT_EVENT_DEFINITIONS) as ShipmentEventCode[];

const createEventSchema = z.object({
  code: z.enum(EVENT_CODES as [ShipmentEventCode, ...ShipmentEventCode[]]),
  label: z.string().trim().min(2).max(200).optional(),
  occurredAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  source: z.enum(["manual", "imported", "external_verified"]).default("manual"),
  metadata: z.record(z.unknown()).optional()
});

function serializeEvent(event: any) {
  return {
    id: event.id,
    shipmentId: event.shipmentId,
    code: event.code,
    label: event.label,
    source: event.source,
    actorUserId: event.actorUserId,
    actorOrganizationId: event.actorOrganizationId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    note: event.note,
    metadata: event.metadata,
    idempotent: false
  };
}

function eventError(
  code: string,
  reason: string
): { ok: false; status: number; code: string; reason: string } {
  return { ok: false, status: 409, code, reason };
}

async function ensureEventTransition(input: {
  shipmentId: string;
  shipmentOrganizationId: string;
  actorOrganizationId: string;
  actorUserId: string;
  code: ShipmentEventCode;
  label?: string;
  occurredAt: Date;
  note?: string;
  idempotencyKey: string;
  source: string;
  metadata?: Record<string, unknown>;
}): Promise<
  | { ok: true; event: any; idempotent: boolean; statusChanged: boolean }
  | { ok: false; status: number; code: string; reason: string }
> {
  if (!prisma) {
    return { ok: false, status: 503, code: "database_required", reason: "Database required" };
  }

  if (input.idempotencyKey) {
    const existing = await prisma.shipmentEvent.findUnique({
      where: {
        shipmentId_idempotencyKey: {
          shipmentId: input.shipmentId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (existing) return { ok: true, event: existing, idempotent: true, statusChanged: false };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize milestone mutations for this shipment. Two concurrent events
      // cannot both observe the same status and then write conflicting updates.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.shipmentId})::bigint)`;
      const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
      if (!shipment) {
        return { ok: false as const, status: 404, code: "shipment_not_found", reason: "Shipment not found" };
      }

      if (input.idempotencyKey) {
        const existing = await tx.shipmentEvent.findUnique({
          where: {
            shipmentId_idempotencyKey: {
              shipmentId: input.shipmentId,
              idempotencyKey: input.idempotencyKey
            }
          }
        });
        if (existing) return { ok: true as const, event: existing, idempotent: true, statusChanged: false };
      }

      const transition = validateEventTransition(input.code, shipment.status);
      if (!transition.ok) {
        return eventError("invalid_shipment_transition", transition.reason);
      }

      const event = await tx.shipmentEvent.create({
        data: {
          shipmentId: input.shipmentId,
          organizationId: input.shipmentOrganizationId,
          code: input.code,
          label: input.label ?? SHIPMENT_EVENT_DEFINITIONS[input.code].label,
          source: input.source,
          actorUserId: input.actorUserId,
          actorOrganizationId: input.actorOrganizationId,
          idempotencyKey: input.idempotencyKey,
          note: input.note,
          metadata: input.metadata as any,
          occurredAt: input.occurredAt
        }
      });

      let statusChanged = false;
      if (transition.nextStatus && transition.nextStatus !== shipment.status) {
        await tx.shipment.update({
          where: { id: input.shipmentId },
          data: { status: transition.nextStatus }
        });
        statusChanged = true;
      }

      return { ok: true as const, event, idempotent: false, statusChanged };
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.shipmentEvent.findUnique({
        where: {
          shipmentId_idempotencyKey: {
            shipmentId: input.shipmentId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      if (existing) return { ok: true, event: existing, idempotent: true, statusChanged: false };
    }
    throw error;
  }
}

export async function registerShipmentEventRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/shipments/:id/events",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      if (!prisma) return reply.code(503).send({ error: "Database required", code: "database_required" });
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const access = await loadShipmentAccess(user, id);
      if (!access) return reply.code(404).send({ error: "Shipment not found" });
      const events = await prisma.shipmentEvent.findMany({
        where: { shipmentId: id },
        orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
        take: 500
      });
      return {
        shipmentId: id,
        status: access.shipment.status,
        items: events.map(serializeEvent)
      };
    }
  );

  app.post(
    "/api/v1/shipments/:id/events",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.update") },
    async (request, reply) => {
      if (!prisma) return reply.code(503).send({ error: "Database required", code: "database_required" });
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = createEventSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      }
      const input = parsed.data;

      if (input.source !== "manual") {
        return reply.code(503).send({
          error: "No live or imported tracking integration is configured",
          code: "live_tracking_integration_unavailable",
          guidance:
            "Only manually entered milestone events can be recorded. Imported and externally verified events require a configured integration."
        });
      }

      const access = await loadShipmentAccess(user, id);
      if (!access) return reply.code(404).send({ error: "Shipment not found" });
      if (!partyAllows(access, "updateStatus")) {
        return reply.code(403).send({
          error: "Insufficient permission to update this shipment",
          code: "insufficient_company_permission",
          permission: "shipments.update"
        });
      }

      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      if (Number.isNaN(occurredAt.getTime())) {
        return reply.code(400).send({ error: "Invalid occurredAt", code: "invalid_occurred_at" });
      }
      if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
        return reply.code(400).send({
          error: "An event cannot be recorded in the future",
          code: "future_event_timestamp"
        });
      }
      const earliest = new Date(access.shipment.createdAt).getTime() - 24 * 60 * 60 * 1000;
      if (occurredAt.getTime() < earliest) {
        return reply.code(400).send({
          error: "The event timestamp precedes the shipment record",
          code: "event_before_shipment"
        });
      }

      const source = access.isOwner ? "manual-customer" : "manual-provider";
      const result = await ensureEventTransition({
        shipmentId: id,
        shipmentOrganizationId: access.shipment.organizationId,
        actorOrganizationId: user.organizationId,
        actorUserId: user.id,
        code: input.code,
        label: input.label,
        occurredAt,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? `manual:${randomUUID()}`,
        source,
        metadata: input.metadata
      });
      if (!result.ok) {
        return reply.code(result.status).send({
          error: result.reason,
          code: result.code
        });
      }

      if (!result.idempotent) {
        await recordAudit({
          organizationId: access.shipment.organizationId,
          actorUserId: user.id,
          action: "shipment.event.recorded",
          entityType: "ShipmentEvent",
          entityId: result.event.id,
          outcome: "success",
          requestId: request.id,
          metadata: {
            shipmentId: id,
            code: input.code,
            source,
            statusChanged: result.statusChanged
          }
        });
        await notify({
          organizationId: access.shipment.organizationId,
          type: input.code === "DELAYED" ? "RISK_ALERT" : "SHIPMENT_MILESTONE",
          title: input.code === "DELAYED" ? "تأخير في الشحنة" : "تحديث مرحلة الشحنة",
          body: `${access.shipment.reference}: ${result.event.label}`,
          dedupeKey: `shipment-event:${result.event.id}`,
          entityType: "Shipment",
          entityId: id,
          severity: input.code === "DELAYED" ? "warning" : "info"
        });
      }

      return { ...serializeEvent(result.event), idempotent: result.idempotent };
    }
  );

  /**
   * Live-tracking boundary. No carrier/AIS/customs provider is configured, so
   * the endpoint returns the recorded event history and an explicit unavailable
   * status rather than inventing a position or carrier update.
   */
  app.get(
    "/api/v1/shipments/:id/tracking",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      if (!prisma) return reply.code(503).send({ error: "Database required", code: "database_required" });
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const access = await loadShipmentAccess(user, id);
      if (!access) return reply.code(404).send({ error: "Shipment not found" });
      const events = await prisma.shipmentEvent.findMany({
        where: { shipmentId: id },
        orderBy: [{ occurredAt: "asc" }, { recordedAt: "asc" }],
        take: 500
      });
      return {
        shipmentId: id,
        status: access.shipment.status,
        liveTracking: {
          available: false,
          code: "live_tracking_unavailable",
          reason:
            "No carrier, AIS, port or customs integration is configured. Locations and carrier status are not inferred."
        },
        events: events.map(serializeEvent)
      };
    }
  );
}

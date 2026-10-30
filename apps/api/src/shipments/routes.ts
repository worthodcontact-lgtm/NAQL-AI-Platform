import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { recordAudit } from "../audit/log.js";
import { requireCompanyPermission } from "../auth/company.js";
import {
  loadShipmentAccess,
  partyAllows,
  visibleShipmentWhere
} from "./access.js";
import { SHIPMENT_TRANSITIONS } from "./state.js";
import { notify } from "../notifications/service.js";

const createSchema = z.object({
  originPortId: z.string().min(1),
  destinationPortId: z.string().min(1),
  mode: z.enum(["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"]),
  incoterm: z.enum(["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"]),
  cargoDescription: z.string().min(3),
  weightKg: z.number().positive(),
  volumeCbm: z.number().positive().optional()
});

const statusSchema = z.object({
  status: z.enum(["DRAFT", "QUOTATION_REQUESTED", "QUOTED", "BOOKED", "IN_TRANSIT", "ARRIVED", "CUSTOMS_CLEARANCE", "DELIVERED", "CANCELLED", "EXCEPTION"])
});

export const PARTY_ROLES = [
  "SHIPPER",
  "CONSIGNEE",
  "FREIGHT_FORWARDER",
  "CARRIER",
  "CUSTOMS_BROKER",
  "WAREHOUSE"
] as const;

const partyPermissionsSchema = z
  .object({
    canView: z.boolean().optional(),
    canUpdateStatus: z.boolean().optional(),
    canUploadDocuments: z.boolean().optional(),
    canViewDocuments: z.boolean().optional(),
    canViewFinancials: z.boolean().optional(),
    canQuote: z.boolean().optional(),
    canManageParties: z.boolean().optional(),
    canConfirmDelivery: z.boolean().optional()
  })
  .partial();

const addPartySchema = z.object({
  companyId: z.string().min(1),
  partyRole: z.enum(PARTY_ROLES),
  permissions: partyPermissionsSchema.optional()
});

const updatePartySchema = z.object({
  partyRole: z.enum(PARTY_ROLES).optional(),
  permissions: partyPermissionsSchema.optional()
});

const SENSITIVE_PARTY_FLAGS = [
  "canViewFinancials",
  "canQuote",
  "canManageParties",
  "canConfirmDelivery"
] as const;

const allowedTransitions: Record<string, string[]> = SHIPMENT_TRANSITIONS;

type DevShipment = {
  id: string;
  reference: string;
  organizationId: string;
  createdByUserId: string;
  originPortId: string;
  destinationPortId: string;
  mode: string;
  incoterm: string;
  status: string;
  cargoDescription: string;
  weightKg: number;
  volumeCbm?: number;
  createdAt: string;
  updatedAt: string;
};

export const devShipments: DevShipment[] = [];

function notFound(reply: any) {
  return reply.code(404).send({ error: "Not found" });
}

function forbidden(reply: any) {
  return reply.code(403).send({ error: "Forbidden" });
}

/**
 * Remove internal collaboration fields from a party row before a non-owner
 * sees it. Company ids/names are enough to collaborate; the owning
 * organization id and the inviter's user id are not.
 */
function partyView(row: any) {
  if (!row) return row;
  const { invitedByUserId: _invitedByUserId, company, ...rest } = row;
  if (!company) return rest;
  const { organizationId: _companyOrganizationId, ...publicCompany } = company;
  return { ...rest, company: publicCompany };
}

/**
 * Shape a shipment for the caller.
 *
 * Owners see every party. A party sees its own row unless it was explicitly
 * granted `canManageParties`. Internal identifiers of the owning organization
 * are removed for non-owners so a collaboration does not become a data export.
 */
function shipmentView(access: NonNullable<Awaited<ReturnType<typeof loadShipmentAccess>>>) {
  const { shipment, party, isOwner } = access;
  if (isOwner) {
    return { ...shipment, viewerRole: "owner" as const };
  }
  const visibleParties = party?.canManageParties
    ? shipment.parties
    : (shipment.parties ?? []).filter((row: any) => row.id === party?.id);
  const { organizationId: _organizationId, createdByUserId: _createdByUserId, ...rest } = shipment;
  return {
    ...rest,
    parties: visibleParties.map(partyView),
    viewerRole: "party" as const,
    myParty: partyView(party),
    access: {
      canUpdateStatus: Boolean(party?.canUpdateStatus),
      canUploadDocuments: Boolean(party?.canUploadDocuments),
      canViewDocuments: Boolean(party?.canViewDocuments),
      canViewFinancials: Boolean(party?.canViewFinancials),
      canQuote: Boolean(party?.canQuote),
      canManageParties: Boolean(party?.canManageParties),
      canConfirmDelivery: Boolean(party?.canConfirmDelivery)
    }
  };
}

export async function registerShipmentRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/shipments",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user.organizationId) return reply.code(403).send({ error: "No organization context" });
      if (prisma) {
        const items = await prisma.shipment.findMany({
          where: visibleShipmentWhere(user),
          include: {
            originPort: { select: { code: true, name: true, country: true } },
            destinationPort: { select: { code: true, name: true, country: true } },
            parties: {
              include: {
                company: { select: { id: true, name: true, organizationId: true, type: true } }
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 100
        });
        return {
          items: items.map((shipment: any) => {
            const isOwner = shipment.organizationId === user.organizationId;
            if (isOwner) return { ...shipment, viewerRole: "owner" };
            const party = shipment.parties.find(
              (row: any) => row.canView && row.company.organizationId === user.organizationId
            );
            const { organizationId: _organizationId, createdByUserId: _createdByUserId, ...rest } = shipment;
            return {
              ...rest,
              parties: (party?.canManageParties
                ? shipment.parties
                : shipment.parties.filter((row: any) => row.id === party?.id)
              ).map(partyView),
              viewerRole: "party",
              myParty: partyView(party)
            };
          })
        };
      }
      return {
        items: devShipments
          .filter((shipment) => shipment.organizationId === user.organizationId)
          .map((shipment) => ({ ...shipment, viewerRole: "owner" })),
        devFallback: true
      };
    }
  );

  app.get(
    "/api/v1/shipments/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const access = await loadShipmentAccess(user, id);
        if (!access) return notFound(reply);
        return shipmentView(access);
      }
      const shipment = devShipments.find((s) => s.id === id && s.organizationId === user.organizationId);
      if (!shipment) return notFound(reply);
      return { ...shipment, viewerRole: "owner", devFallback: true };
    }
  );

  app.post(
    "/api/v1/shipments",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.create") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!user.organizationId) return reply.code(403).send({ error: "No organization context" });
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const input = parsed.data;

      if (prisma) {
        // Ports may be referenced by their stable code (e.g. "ALY") or by their database id.
        // The seeded reference data is code-identified, so codes are the natural client input.
        const resolvePort = async (value: string) => {
          const byCode = await prisma!.port.findUnique({ where: { code: value } });
          if (byCode) return byCode.id as string;
          const byId = await prisma!.port.findUnique({ where: { id: value } });
          return byId ? (byId.id as string) : null;
        };

        const originPortId = await resolvePort(input.originPortId);
        const destinationPortId = await resolvePort(input.destinationPortId);
        if (!originPortId || !destinationPortId) {
          return reply.code(400).send({
            error: "Unknown port",
            issues: [{ message: "originPortId or destinationPortId is neither a known port code nor a known port id" }]
          });
        }

        const shipment = await prisma.shipment.create({
          data: {
            reference: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            organizationId: user.organizationId,
            createdByUserId: user.id,
            originPortId,
            destinationPortId,
            mode: input.mode,
            incoterm: input.incoterm,
            cargoDescription: input.cargoDescription,
            weightKg: input.weightKg,
            volumeCbm: input.volumeCbm,
            status: "DRAFT"
          }
        });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "shipment.create",
          entityType: "Shipment",
          entityId: shipment.id,
          outcome: "success",
          requestId: request.id,
          metadata: { mode: input.mode, incoterm: input.incoterm }
        });
        return shipment;
      }

      const shipment: DevShipment = {
        id: `dev-${devShipments.length + 1}`,
        reference: `SHP-${Date.now()}`,
        organizationId: user.organizationId,
        createdByUserId: user.id,
        ...input,
        status: "DRAFT",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      devShipments.push(shipment);
      return { ...shipment, devFallback: true };
    }
  );

  app.patch(
    "/api/v1/shipments/:id/status",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.update") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const nextStatus = parsed.data.status;

      if (prisma) {
        const access = await loadShipmentAccess(user, id);
        if (!access) return notFound(reply);
        if (!partyAllows(access, "updateStatus")) return forbidden(reply);
        const shipment = access.shipment;
        if (!allowedTransitions[shipment.status]?.includes(nextStatus)) {
          return reply.code(409).send({ error: "Invalid status transition", from: shipment.status, to: nextStatus });
        }
        let updated: any;
        try {
          updated = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
            const current = await tx.shipment.findUnique({ where: { id } });
            if (!current) throw Object.assign(new Error("shipment_not_found"), { code: "shipment_not_found" });
            if (!allowedTransitions[current.status]?.includes(nextStatus)) {
              throw Object.assign(new Error("invalid_shipment_transition"), {
                code: "invalid_shipment_transition",
                from: current.status
              });
            }
            return tx.shipment.update({ where: { id }, data: { status: nextStatus } });
          });
        } catch (error: any) {
          if (error?.code === "shipment_not_found") return notFound(reply);
          if (error?.code === "invalid_shipment_transition") {
            return reply.code(409).send({
              error: "Invalid status transition",
              code: error.code,
              from: error.from,
              to: nextStatus
            });
          }
          throw error;
        }
        await recordAudit({
          organizationId: shipment.organizationId,
          actorUserId: user.id,
          action: "shipment.status.changed",
          entityType: "Shipment",
          entityId: id,
          outcome: "success",
          requestId: request.id,
          metadata: { from: shipment.status, to: nextStatus, actorRole: access.role }
        });
        await notify({
          organizationId: shipment.organizationId,
          type: nextStatus === "EXCEPTION" ? "RISK_ALERT" : "SHIPMENT_MILESTONE",
          title: nextStatus === "EXCEPTION" ? "تنبيه على الشحنة" : "تغيرت حالة الشحنة",
          body: `${shipment.reference}: ${shipment.status} → ${nextStatus}`,
          dedupeKey: `shipment-status:${id}:${nextStatus}:${Date.now()}`,
          entityType: "Shipment",
          entityId: id,
          severity: nextStatus === "EXCEPTION" ? "warning" : "info"
        });
        return updated;
      }

      const shipment = devShipments.find((s) => s.id === id && s.organizationId === user.organizationId);
      if (!shipment) return notFound(reply);
      if (!allowedTransitions[shipment.status]?.includes(nextStatus)) {
        return reply.code(409).send({ error: "Invalid status transition", from: shipment.status, to: nextStatus });
      }
      shipment.status = nextStatus;
      shipment.updatedAt = new Date().toISOString();
      return { ...shipment, devFallback: true };
    }
  );

  app.delete(
    "/api/v1/shipments/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.delete") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const shipment = await prisma.shipment.findUnique({ where: { id } });
        if (!shipment || shipment.organizationId !== user.organizationId) return notFound(reply);
        await prisma.shipment.delete({ where: { id } });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "shipment.deleted",
          entityType: "Shipment",
          entityId: id,
          outcome: "success",
          requestId: request.id,
          metadata: { reference: shipment.reference }
        });
        return { deleted: true };
      }
      const index = devShipments.findIndex((s) => s.id === id && s.organizationId === user.organizationId);
      if (index === -1) return notFound(reply);
      devShipments.splice(index, 1);
      return { deleted: true, devFallback: true };
    }
  );

  // ---------------------------------------------------------- shipment parties

  app.post(
    "/api/v1/shipments/:id/parties",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.parties.manage") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) {
        return reply.code(503).send({ error: "Shipment collaboration requires the database", code: "database_required" });
      }
      const { id } = request.params as { id: string };
      const parsed = addPartySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      const access = await loadShipmentAccess(user, id);
      if (!access) return notFound(reply);
      if (!partyAllows(access, "manageParties")) return forbidden(reply);

      const company = await prisma.company.findUnique({ where: { id: parsed.data.companyId } });
      if (!company) return reply.code(404).send({ error: "Company not found", code: "company_not_found" });
      if (company.organizationId === access.shipment.organizationId) {
        return reply.code(409).send({ error: "The owner organization is not a party", code: "owner_company" });
      }

      const requested = parsed.data.permissions ?? {};
      if (!access.isOwner) {
        const sensitive = SENSITIVE_PARTY_FLAGS.find((flag) => requested[flag] === true);
        if (sensitive) {
          return reply.code(403).send({
            error: "Only the shipment owner can grant that permission",
            code: "sensitive_party_permission",
            permission: sensitive
          });
        }
      }

      const party = await prisma.shipmentParty.upsert({
        where: { shipmentId_companyId: { shipmentId: id, companyId: company.id } },
        update: {
          partyRole: parsed.data.partyRole,
          ...(requested.canView !== undefined ? { canView: requested.canView } : {}),
          ...(requested.canUpdateStatus !== undefined ? { canUpdateStatus: requested.canUpdateStatus } : {}),
          ...(requested.canUploadDocuments !== undefined ? { canUploadDocuments: requested.canUploadDocuments } : {}),
          ...(requested.canViewDocuments !== undefined ? { canViewDocuments: requested.canViewDocuments } : {}),
          ...(requested.canViewFinancials !== undefined ? { canViewFinancials: requested.canViewFinancials } : {}),
          ...(requested.canQuote !== undefined ? { canQuote: requested.canQuote } : {}),
          ...(requested.canManageParties !== undefined ? { canManageParties: requested.canManageParties } : {}),
          ...(requested.canConfirmDelivery !== undefined ? { canConfirmDelivery: requested.canConfirmDelivery } : {})
        },
        create: {
          shipmentId: id,
          companyId: company.id,
          partyRole: parsed.data.partyRole,
          canView: requested.canView ?? true,
          canUpdateStatus: requested.canUpdateStatus ?? false,
          canUploadDocuments: requested.canUploadDocuments ?? false,
          canViewDocuments: requested.canViewDocuments ?? false,
          canViewFinancials: requested.canViewFinancials ?? false,
          canQuote: requested.canQuote ?? false,
          canManageParties: requested.canManageParties ?? false,
          canConfirmDelivery: requested.canConfirmDelivery ?? false,
          invitedByUserId: user.id
        }
      });

      await recordAudit({
        organizationId: access.shipment.organizationId,
        actorUserId: user.id,
        action: "shipment.party.added",
        entityType: "ShipmentParty",
        entityId: party.id,
        outcome: "success",
        requestId: request.id,
        metadata: { shipmentId: id, companyId: company.id, partyRole: party.partyRole }
      });

      return { party };
    }
  );

  app.patch(
    "/api/v1/shipments/:id/parties/:partyId",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.parties.manage") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) {
        return reply.code(503).send({ error: "Shipment collaboration requires the database", code: "database_required" });
      }
      const { id, partyId } = request.params as { id: string; partyId: string };
      const parsed = updatePartySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      const access = await loadShipmentAccess(user, id);
      if (!access) return notFound(reply);
      if (!partyAllows(access, "manageParties")) return forbidden(reply);

      const target = await prisma.shipmentParty.findFirst({ where: { id: partyId, shipmentId: id } });
      if (!target) return reply.code(404).send({ error: "Party not found", code: "party_not_found" });
      if (!access.isOwner && target.companyId === access.party?.companyId) {
        return reply.code(403).send({ error: "You cannot change your own shipment permissions", code: "cannot_change_own_party" });
      }
      if (!access.isOwner && target.canManageParties) {
        return reply.code(403).send({ error: "Only the shipment owner can modify a party manager", code: "owner_required" });
      }

      const requested = parsed.data.permissions ?? {};
      if (!access.isOwner) {
        const sensitive = SENSITIVE_PARTY_FLAGS.find((flag) => requested[flag] === true);
        if (sensitive) {
          return reply.code(403).send({
            error: "Only the shipment owner can grant that permission",
            code: "sensitive_party_permission",
            permission: sensitive
          });
        }
      }

      const party = await prisma.shipmentParty.update({
        where: { id: target.id },
        data: {
          ...(parsed.data.partyRole ? { partyRole: parsed.data.partyRole } : {}),
          ...(requested.canView !== undefined ? { canView: requested.canView } : {}),
          ...(requested.canUpdateStatus !== undefined ? { canUpdateStatus: requested.canUpdateStatus } : {}),
          ...(requested.canUploadDocuments !== undefined ? { canUploadDocuments: requested.canUploadDocuments } : {}),
          ...(requested.canViewDocuments !== undefined ? { canViewDocuments: requested.canViewDocuments } : {}),
          ...(requested.canViewFinancials !== undefined ? { canViewFinancials: requested.canViewFinancials } : {}),
          ...(requested.canQuote !== undefined ? { canQuote: requested.canQuote } : {}),
          ...(requested.canManageParties !== undefined ? { canManageParties: requested.canManageParties } : {}),
          ...(requested.canConfirmDelivery !== undefined ? { canConfirmDelivery: requested.canConfirmDelivery } : {})
        }
      });

      await recordAudit({
        organizationId: access.shipment.organizationId,
        actorUserId: user.id,
        action: "shipment.party.updated",
        entityType: "ShipmentParty",
        entityId: party.id,
        outcome: "success",
        requestId: request.id,
        metadata: { shipmentId: id, companyId: party.companyId, permissions: requested }
      });

      return { party };
    }
  );

  app.delete(
    "/api/v1/shipments/:id/parties/:partyId",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.parties.manage") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) {
        return reply.code(503).send({ error: "Shipment collaboration requires the database", code: "database_required" });
      }
      const { id, partyId } = request.params as { id: string; partyId: string };

      const access = await loadShipmentAccess(user, id);
      if (!access) return notFound(reply);
      if (!partyAllows(access, "manageParties")) return forbidden(reply);

      const target = await prisma.shipmentParty.findFirst({ where: { id: partyId, shipmentId: id } });
      if (!target) return reply.code(404).send({ error: "Party not found", code: "party_not_found" });
      if (!access.isOwner) {
        if (target.companyId === access.party?.companyId) {
          return reply.code(403).send({ error: "You cannot remove your own company", code: "cannot_remove_own_party" });
        }
        if (target.canManageParties) {
          return reply.code(403).send({ error: "Only the shipment owner can remove a party manager", code: "owner_required" });
        }
      }

      await prisma.shipmentParty.delete({ where: { id: target.id } });
      await recordAudit({
        organizationId: access.shipment.organizationId,
        actorUserId: user.id,
        action: "shipment.party.removed",
        entityType: "ShipmentParty",
        entityId: target.id,
        outcome: "success",
        requestId: request.id,
        metadata: { shipmentId: id, companyId: target.companyId }
      });

      return { removed: true };
    }
  );
}

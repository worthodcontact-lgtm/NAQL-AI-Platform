import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";

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

const allowedTransitions: Record<string, string[]> = {
  DRAFT: ["QUOTATION_REQUESTED", "CANCELLED"],
  QUOTATION_REQUESTED: ["QUOTED", "CANCELLED"],
  QUOTED: ["BOOKED", "CANCELLED"],
  BOOKED: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED", "EXCEPTION"],
  ARRIVED: ["CUSTOMS_CLEARANCE"],
  CUSTOMS_CLEARANCE: ["DELIVERED"],
  EXCEPTION: ["IN_TRANSIT", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: []
};

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

function forbidden(reply: any) {
  return reply.code(403).send({ error: "Forbidden" });
}

function notFound(reply: any) {
  return reply.code(404).send({ error: "Not found" });
}

export async function registerShipmentRoutes(app: FastifyInstance) {
  app.get("/api/v1/shipments", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.organizationId) return reply.code(403).send({ error: "No organization context" });
    if (prisma) {
      const items = await (prisma as any).shipment.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return { items };
    }
    return { items: devShipments.filter((s) => s.organizationId === user.organizationId), devFallback: true };
  });

  app.get("/api/v1/shipments/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const shipment = await (prisma as any).shipment.findUnique({ where: { id } });
      if (!shipment || shipment.organizationId !== user.organizationId) return notFound(reply);
      return shipment;
    }
    const shipment = devShipments.find((s) => s.id === id && s.organizationId === user.organizationId);
    if (!shipment) return notFound(reply);
    return { ...shipment, devFallback: true };
  });

  app.post("/api/v1/shipments", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.organizationId) return reply.code(403).send({ error: "No organization context" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (prisma) {
      if (await (prisma as any).port.findUnique({ where: { id: input.originPortId } }) === null ||
          await (prisma as any).port.findUnique({ where: { id: input.destinationPortId } }) === null) {
        return reply.code(400).send({ error: "Unknown port", issues: [{ message: "originPortId or destinationPortId does not exist" }] });
      }
      const shipment = await (prisma as any).shipment.create({
        data: {
          reference: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          organizationId: user.organizationId,
          createdByUserId: user.id,
          originPortId: input.originPortId,
          destinationPortId: input.destinationPortId,
          mode: input.mode,
          incoterm: input.incoterm,
          cargoDescription: input.cargoDescription,
          weightKg: input.weightKg,
          volumeCbm: input.volumeCbm,
          status: "DRAFT"
        }
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
  });

  app.patch("/api/v1/shipments/:id/status", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const nextStatus = parsed.data.status;

    if (prisma) {
      const shipment = await (prisma as any).shipment.findUnique({ where: { id } });
      if (!shipment || shipment.organizationId !== user.organizationId) return notFound(reply);
      if (!allowedTransitions[shipment.status]?.includes(nextStatus)) {
        return reply.code(409).send({ error: "Invalid status transition", from: shipment.status, to: nextStatus });
      }
      const updated = await (prisma as any).shipment.update({ where: { id }, data: { status: nextStatus } });
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
  });

  app.delete("/api/v1/shipments/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const shipment = await (prisma as any).shipment.findUnique({ where: { id } });
      if (!shipment || shipment.organizationId !== user.organizationId) return notFound(reply);
      await (prisma as any).shipment.delete({ where: { id } });
      return { deleted: true };
    }
    const index = devShipments.findIndex((s) => s.id === id && s.organizationId === user.organizationId);
    if (index === -1) return notFound(reply);
    devShipments.splice(index, 1);
    return { deleted: true, devFallback: true };
  });
}

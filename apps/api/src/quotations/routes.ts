import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";

type DevOffer = { id: string; quotationRequestId: string; providerId: string; currency: string; amount: number; transitDays: number; validityUntil: string };
type DevQuote = { id: string; shipmentId: string; organizationId: string; status: string; requestedAt: string; offers: DevOffer[] };

const devQuotes: DevQuote[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

export async function registerQuotationRoutes(app: FastifyInstance) {
  app.post("/api/v1/quotations", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const parsed = z.object({ shipmentId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const { shipmentId } = parsed.data;

    if (prisma) {
      const shipment = await (prisma as any).shipment.findUnique({ where: { id: shipmentId } });
      if (!shipment) return reply.code(404).send({ error: "Shipment not found" });
      if (shipment.organizationId !== user.organizationId) return forbidden(reply);
      const q = await (prisma as any).quotationRequest.create({
        data: { shipmentId, organizationId: user.organizationId, status: "open" },
        include: { offers: true }
      });
      await (prisma as any).shipment.update({ where: { id: shipmentId }, data: { status: "QUOTATION_REQUESTED" } });
      return q;
    }

    const { devShipments } = await import("../shipments/routes.js");
    const shipment = devShipments.find((s: any) => s.id === shipmentId && s.organizationId === user.organizationId);
    if (!shipment) return reply.code(404).send({ error: "Shipment not found" });
    const q: DevQuote = { id: `dev-q-${devQuotes.length + 1}`, shipmentId, organizationId: user.organizationId, status: "open", requestedAt: new Date().toISOString(), offers: [] };
    devQuotes.push(q);
    return { ...q, devFallback: true };
  });

  app.get("/api/v1/quotations", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    if (prisma) {
      const items = await (prisma as any).quotationRequest.findMany({
        where: { organizationId: user.organizationId },
        include: { offers: true },
        orderBy: { requestedAt: "desc" },
        take: 100
      });
      return { items };
    }
    return { items: devQuotes.filter((q) => q.organizationId === user.organizationId), devFallback: true };
  });

  app.get("/api/v1/quotations/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const q = await (prisma as any).quotationRequest.findUnique({ where: { id }, include: { offers: true } });
      if (!q || q.organizationId !== user.organizationId) return notFound(reply);
      return q;
    }
    const q = devQuotes.find((x) => x.id === id && x.organizationId === user.organizationId);
    if (!q) return notFound(reply);
    return { ...q, devFallback: true };
  });

  const offerSchema = z.object({
    providerId: z.string().min(1),
    currency: z.string().length(3),
    amount: z.number().positive(),
    transitDays: z.number().int().positive(),
    validityUntil: z.string().min(1)
  });

  app.post("/api/v1/quotations/:id/offers", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = offerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const quote = await (prisma as any).quotationRequest.findUnique({ where: { id } });
      if (!quote || quote.organizationId !== user.organizationId) return notFound(reply);
      if (quote.status === "closed" || quote.status === "awarded") return reply.code(409).send({ error: "Quotation is not open" });
      const offer = await (prisma as any).quotationOffer.create({ data: { quotationRequestId: id, ...parsed.data, validityUntil: new Date(parsed.data.validityUntil) } });
      return offer;
    }

    const quote = devQuotes.find((q) => q.id === id && q.organizationId === user.organizationId);
    if (!quote) return notFound(reply);
    if (quote.status === "closed" || quote.status === "awarded") return reply.code(409).send({ error: "Quotation is not open" });
    const offer: DevOffer = { id: `dev-o-${quote.offers.length + 1}`, quotationRequestId: id, providerId: parsed.data.providerId, currency: parsed.data.currency, amount: parsed.data.amount, transitDays: parsed.data.transitDays, validityUntil: parsed.data.validityUntil };
    quote.offers.push(offer);
    return { ...offer, devFallback: true };
  });

  app.post("/api/v1/quotations/:id/award", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ offerId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const quote = await (prisma as any).quotationRequest.findUnique({ where: { id }, include: { offers: true } });
      if (!quote || quote.organizationId !== user.organizationId) return notFound(reply);
      const offer = quote.offers.find((o: any) => o.id === parsed.data.offerId);
      if (!offer) return reply.code(404).send({ error: "Offer not found" });
      const updated = await (prisma as any).quotationRequest.update({ where: { id }, data: { status: "awarded" }, include: { offers: true } });
      await (prisma as any).shipment.update({ where: { id: quote.shipmentId }, data: { status: "QUOTED" } });
      return updated;
    }

    const quote = devQuotes.find((q) => q.id === id && q.organizationId === user.organizationId);
    if (!quote) return notFound(reply);
    const offer = quote.offers.find((o) => o.id === parsed.data.offerId);
    if (!offer) return reply.code(404).send({ error: "Offer not found" });
    quote.status = "awarded";
    return { ...quote, devFallback: true };
  });
}

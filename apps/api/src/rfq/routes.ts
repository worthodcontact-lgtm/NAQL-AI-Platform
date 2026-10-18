import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { isPlatformStaff } from "../auth/roles.js";
import { recordAudit } from "../audit/log.js";
import { devCompanies } from "../companies/routes.js";

type DevRfq = { id: string; organizationId: string; createdByUserId: string; origin: string; destination: string; mode: string; cargoDescription: string; weightKg: number; status: string; createdAt: string; updatedAt: string; recipients: any[] };
type DevQuote = { id: string; rfqId: string; companyId: string; organizationId: string; currency: string; totalAmount: number; transitDays: number; validityUntil: string; status: string; createdAt: string; items: any[] };
type DevBooking = { id: string; rfqId?: string; quoteId?: string; organizationId: string; createdByUserId: string; status: string; confirmedAt?: string; externalReference?: string; createdAt: string; updatedAt: string; trackingEvents: any[] };

export const devRfqs: DevRfq[] = [];
export const devQuotesList: DevQuote[] = [];
export const devBookings: DevBooking[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

function ownsDevCompany(organizationId: string, companyId: string) {
  return devCompanies.some((c) => c.id === companyId && c.organizationId === organizationId);
}

async function ownsCompanyDb(organizationId: string, companyId: string) {
  if (!prisma) return ownsDevCompany(organizationId, companyId);
  const company = await (prisma as any).company.findUnique({ where: { id: companyId } });
  return Boolean(company && company.organizationId === organizationId);
}

export async function registerRfqRoutes(app: FastifyInstance) {
  const createSchema = z.object({
    origin: z.string().min(2),
    destination: z.string().min(2),
    mode: z.enum(["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"]),
    cargoDescription: z.string().min(3),
    weightKg: z.number().positive(),
    recipientCompanyIds: z.array(z.string()).optional()
  });

  app.post("/api/v1/rfqs", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (prisma) {
      const rfq = await (prisma as any).rfq.create({
        data: {
          organizationId: user.organizationId,
          createdByUserId: user.id,
          origin: input.origin,
          destination: input.destination,
          mode: input.mode,
          cargoDescription: input.cargoDescription,
          weightKg: input.weightKg,
          status: "submitted",
          recipients: input.recipientCompanyIds?.length ? { create: input.recipientCompanyIds.map((companyId) => ({ companyId })) } : undefined
        },
        include: { recipients: true, quotes: true }
      });
      await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "rfq.create", entityType: "Rfq", entityId: rfq.id });
      return rfq;
    }

    const rfq: DevRfq = {
      id: `dev-rfq-${devRfqs.length + 1}`,
      organizationId: user.organizationId,
      createdByUserId: user.id,
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
      cargoDescription: input.cargoDescription,
      weightKg: input.weightKg,
      status: "submitted",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recipients: (input.recipientCompanyIds ?? []).map((companyId, i) => ({ id: `dev-recipient-${i + 1}`, companyId, status: "invited" }))
    };
    devRfqs.push(rfq);
    await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "rfq.create", entityType: "Rfq", entityId: rfq.id });
    return { ...rfq, devFallback: true };
  });

  app.get("/api/v1/rfqs", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    if (prisma) {
      const items = await (prisma as any).rfq.findMany({ where: { organizationId: user.organizationId }, include: { recipients: true, quotes: true }, orderBy: { createdAt: "desc" }, take: 100 });
      return { items };
    }
    return { items: devRfqs.filter((r) => r.organizationId === user.organizationId), devFallback: true };
  });

  app.get("/api/v1/rfqs/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const rfq = await (prisma as any).rfq.findUnique({ where: { id }, include: { recipients: true, quotes: { include: { items: true } } } });
      if (!rfq) return notFound(reply);
      const isOwner = rfq.organizationId === user.organizationId;
      const isInvited = await Promise.all(rfq.recipients.map((r: any) => ownsCompanyDb(user.organizationId, r.companyId)));
      if (!isOwner && !isInvited.some(Boolean) && !isPlatformStaff(user)) return forbidden(reply);
      return rfq;
    }
    const rfq = devRfqs.find((r) => r.id === id);
    if (!rfq) return notFound(reply);
    const isOwner = rfq.organizationId === user.organizationId;
    const isInvited = rfq.recipients.some((r) => ownsDevCompany(user.organizationId, r.companyId));
    if (!isOwner && !isInvited && !isPlatformStaff(user)) return forbidden(reply);
    return { ...rfq, quotes: devQuotesList.filter((q) => q.rfqId === id), devFallback: true };
  });

  const quoteSchema = z.object({
    companyId: z.string().min(1),
    currency: z.string().length(3),
    transitDays: z.number().int().positive(),
    validityUntil: z.string().min(1),
    items: z.array(z.object({ label: z.string().min(1), amount: z.number().nonnegative(), currency: z.string().length(3), included: z.boolean().optional() })).min(1)
  });

  app.post("/api/v1/rfqs/:id/quotes", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;
    if (!(await ownsCompanyDb(user.organizationId, input.companyId))) return forbidden(reply);

    const totalAmount = input.items.filter((i) => i.included !== false).reduce((sum, i) => sum + i.amount, 0);

    if (prisma) {
      const rfq = await (prisma as any).rfq.findUnique({ where: { id } });
      if (!rfq) return notFound(reply);
      const quote = await (prisma as any).quote.create({
        data: {
          rfqId: id,
          companyId: input.companyId,
          organizationId: rfq.organizationId,
          currency: input.currency,
          totalAmount,
          transitDays: input.transitDays,
          validityUntil: new Date(input.validityUntil),
          status: "submitted",
          items: { create: input.items.map((i) => ({ label: i.label, amount: i.amount, currency: i.currency, included: i.included ?? true })) }
        },
        include: { items: true }
      });
      await recordAudit({ actorUserId: user.id, action: "quote.submit", entityType: "Quote", entityId: quote.id, organizationId: rfq.organizationId });
      return quote;
    }

    const rfq = devRfqs.find((r) => r.id === id);
    if (!rfq) return notFound(reply);
    const quote: DevQuote = {
      id: `dev-quote-${devQuotesList.length + 1}`,
      rfqId: id,
      companyId: input.companyId,
      organizationId: rfq.organizationId,
      currency: input.currency,
      totalAmount,
      transitDays: input.transitDays,
      validityUntil: input.validityUntil,
      status: "submitted",
      createdAt: new Date().toISOString(),
      items: input.items.map((i, idx) => ({ id: `dev-qi-${idx + 1}`, ...i, included: i.included ?? true }))
    };
    devQuotesList.push(quote);
    return { ...quote, devFallback: true };
  });

  app.post("/api/v1/rfqs/:id/accept", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ quoteId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const rfq = await (prisma as any).rfq.findUnique({ where: { id }, include: { quotes: true } });
      if (!rfq || rfq.organizationId !== user.organizationId) return notFound(reply);
      const quote = rfq.quotes.find((q: any) => q.id === parsed.data.quoteId);
      if (!quote) return reply.code(404).send({ error: "Quote not found" });
      const booking = await (prisma as any).bookingRequest.create({
        data: { rfqId: id, quoteId: quote.id, organizationId: user.organizationId, createdByUserId: user.id, status: "requested" }
      });
      await (prisma as any).rfq.update({ where: { id }, data: { status: "accepted" } });
      await (prisma as any).quote.update({ where: { id: quote.id }, data: { status: "accepted" } });
      await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "booking.request", entityType: "BookingRequest", entityId: booking.id });
      return booking;
    }

    const rfq = devRfqs.find((r) => r.id === id && r.organizationId === user.organizationId);
    if (!rfq) return notFound(reply);
    const quote = devQuotesList.find((q) => q.id === parsed.data.quoteId && q.rfqId === id);
    if (!quote) return reply.code(404).send({ error: "Quote not found" });
    const booking: DevBooking = {
      id: `dev-booking-${devBookings.length + 1}`,
      rfqId: id,
      quoteId: quote.id,
      organizationId: user.organizationId,
      createdByUserId: user.id,
      status: "requested",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trackingEvents: []
    };
    devBookings.push(booking);
    rfq.status = "accepted";
    quote.status = "accepted";
    return { ...booking, devFallback: true };
  });

  app.get("/api/v1/bookings", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    if (prisma) {
      const items = await (prisma as any).bookingRequest.findMany({ where: { organizationId: user.organizationId }, include: { trackingEvents: true }, orderBy: { createdAt: "desc" }, take: 100 });
      return { items };
    }
    return { items: devBookings.filter((b) => b.organizationId === user.organizationId), devFallback: true };
  });

  app.post("/api/v1/bookings/:id/confirm", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ externalReference: z.string().min(1), companyId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const booking = await (prisma as any).bookingRequest.findUnique({ where: { id } });
      if (!booking) return notFound(reply);
      if (booking.status === "confirmed") return reply.code(409).send({ error: "Booking already confirmed" });
      const updated = await (prisma as any).bookingRequest.update({ where: { id }, data: { status: "confirmed", confirmedAt: new Date(), externalReference: parsed.data.externalReference } });
      await recordAudit({ organizationId: booking.organizationId, actorUserId: user.id, action: "booking.confirm", entityType: "BookingRequest", entityId: id });
      return updated;
    }

    const booking = devBookings.find((b) => b.id === id);
    if (!booking) return notFound(reply);
    if (booking.status === "confirmed") return reply.code(409).send({ error: "Booking already confirmed" });
    booking.status = "confirmed";
    booking.confirmedAt = new Date().toISOString();
    booking.externalReference = parsed.data.externalReference;
    booking.updatedAt = booking.confirmedAt;
    await recordAudit({ organizationId: booking.organizationId, actorUserId: user.id, action: "booking.confirm", entityType: "BookingRequest", entityId: id });
    return { ...booking, devFallback: true };
  });

  app.post("/api/v1/bookings/:id/tracking", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ code: z.string().min(1), label: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const booking = await (prisma as any).bookingRequest.findUnique({ where: { id } });
      if (!booking || booking.organizationId !== user.organizationId) return notFound(reply);
      const event = await (prisma as any).trackingEvent.create({ data: { bookingRequestId: id, ...parsed.data, source: "manual" } });
      return event;
    }
    const booking = devBookings.find((b) => b.id === id && b.organizationId === user.organizationId);
    if (!booking) return notFound(reply);
    const event = { id: `dev-te-${booking.trackingEvents.length + 1}`, ...parsed.data, source: "manual", occurredAt: new Date().toISOString() };
    booking.trackingEvents.push(event);
    return { ...event, devFallback: true };
  });
}

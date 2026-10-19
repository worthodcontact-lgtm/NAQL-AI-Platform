import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { can, isPlatformStaff } from "../auth/roles.js";
import { recordAudit } from "../audit/log.js";
import { organizationOwnsCompany } from "../companies/ownership.js";
import { devCompanies } from "../companies/routes.js";

type DevRfq = { id: string; organizationId: string; createdByUserId: string; origin: string; destination: string; mode: string; cargoDescription: string; weightKg: number; status: string; createdAt: string; updatedAt: string; recipients: any[] };
type DevQuote = { id: string; rfqId: string; companyId: string; organizationId: string; currency: string; totalAmount: number; transitDays: number; validityUntil: string; status: string; createdAt: string; items: any[] };
type DevBooking = { id: string; rfqId?: string; quoteId?: string; organizationId: string; createdByUserId: string; status: string; confirmedAt?: string; externalReference?: string; createdAt: string; updatedAt: string; trackingEvents: any[] };

export const devRfqs: DevRfq[] = [];
export const devQuotesList: DevQuote[] = [];
export const devBookings: DevBooking[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

/** Provider-side authorization: the caller must own the company on the quote. */
async function ownsCompanyDb(organizationId: string, companyId: string) {
  return organizationOwnsCompany(organizationId, companyId);
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

  /**
   * Provider inbox: RFQs addressed to any company owned by the caller's organization.
   * Authorization comes from company ownership, never from a client-supplied id.
   */
  app.get("/api/v1/rfqs/incoming", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);

    if (prisma) {
      const companies = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true }
      });
      if (companies.length === 0) return { items: [], companies: [] };
      const companyIds = companies.map((c: any) => c.id);

      const items = await (prisma as any).rfqRecipient.findMany({
        where: { companyId: { in: companyIds } },
        include: {
          rfq: { include: { quotes: true } },
          company: { select: { id: true, name: true } }
        },
        orderBy: { invitedAt: "desc" },
        take: 100
      });
      return { items, companies };
    }

    const mine = devCompanies.filter((c) => c.organizationId === user.organizationId);
    const mineIds = mine.map((c) => c.id);
    const items = devRfqs
      .filter((r) => r.recipients.some((rec: any) => mineIds.includes(rec.companyId)))
      .map((r) => {
        const myRecipient = r.recipients.find((rec: any) => mineIds.includes(rec.companyId));
        const company = mine.find((c) => c.id === myRecipient?.companyId) ?? null;
        return {
          id: `dev-invite-${r.id}`,
          rfqId: r.id,
          status: myRecipient?.status ?? "invited",
          invitedAt: (myRecipient as any)?.invitedAt ?? r.createdAt,
          company: company ? { id: company.id, name: company.name } : null,
          rfq: { ...r, quotes: devQuotesList.filter((q) => q.rfqId === r.id) },
          devFallback: true
        };
      });
    return {
      items,
      companies: mine.map((c) => ({ id: c.id, name: c.name })),
      devFallback: true
    };
  });

  app.get("/api/v1/rfqs/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const rfq = await (prisma as any).rfq.findUnique({ where: { id }, include: { recipients: true, quotes: { include: { items: true } } } });
      if (!rfq) return notFound(reply);
      const isOwner = rfq.organizationId === user.organizationId;
      const isInvited = await Promise.all(rfq.recipients.map((r: any) => ownsCompanyDb(user.organizationId, r.companyId)));
      if (!isOwner && !isInvited.some(Boolean) && !can(user, "rfqs.read")) return forbidden(reply);
      return rfq;
    }
    const rfq = devRfqs.find((r) => r.id === id);
    if (!rfq) return notFound(reply);
    const isOwner = rfq.organizationId === user.organizationId;
    const invitedChecks = await Promise.all(rfq.recipients.map((r: any) => organizationOwnsCompany(user.organizationId, r.companyId)));
    const isInvited = invitedChecks.some(Boolean);
    if (!isOwner && !isInvited && !can(user, "rfqs.read")) return forbidden(reply);
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

  /**
   * Returns the company that must confirm this booking, plus the booking itself.
   * The confirming authority is derived from the accepted quote, never from the client.
   */
  async function bookingWithAuthority(id: string) {
    if (prisma) {
      const booking = await (prisma as any).bookingRequest.findUnique({
        where: { id },
        include: { rfq: { include: { quotes: true } }, trackingEvents: true }
      });
      if (!booking) return null;
      const quote = (booking.rfq?.quotes ?? []).find((q: any) => q.id === booking.quoteId);
      return { booking, providerCompanyId: quote?.companyId as string | undefined };
    }
    const booking = devBookings.find((b) => b.id === id);
    if (!booking) return null;
    const quote = devQuotesList.find((q) => q.id === booking.quoteId);
    return { booking, providerCompanyId: quote?.companyId };
  }

  async function confirmOrRejectBooking(
    request: any,
    reply: any,
    nextStatus: "confirmed" | "rejected"
  ) {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ externalReference: z.string().min(1).optional(), reason: z.string().optional() })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (nextStatus === "confirmed" && !parsed.data.externalReference) {
      return reply.code(400).send({ error: "externalReference is required to confirm a booking" });
    }

    const resolved = await bookingWithAuthority(id);
    if (!resolved) return notFound(reply);
    const { booking, providerCompanyId } = resolved;

    // Only the provider that owns the accepted quote, or platform staff, may decide.
    const isProvider = providerCompanyId
      ? await organizationOwnsCompany(user.organizationId, providerCompanyId)
      : false;
    if (!isProvider && !(isPlatformStaff(user) && can(user, "bookings.manage"))) return forbidden(reply);

    if (booking.status === "confirmed" || booking.status === "rejected" || booking.status === "cancelled") {
      return reply.code(409).send({ error: `Booking is already ${booking.status}` });
    }

    if (prisma) {
      const updated = await (prisma as any).bookingRequest.update({
        where: { id },
        data: {
          status: nextStatus,
          confirmedAt: nextStatus === "confirmed" ? new Date() : null,
          externalReference: nextStatus === "confirmed" ? parsed.data.externalReference : null
        }
      });
      await recordAudit({
        organizationId: booking.organizationId,
        actorUserId: user.id,
        action: `booking.${nextStatus}`,
        entityType: "BookingRequest",
        entityId: id,
        metadata: { providerCompanyId, byPlatformStaff: !isProvider }
      });
      return updated;
    }

    booking.status = nextStatus;
    booking.confirmedAt = nextStatus === "confirmed" ? new Date().toISOString() : undefined;
    booking.externalReference = nextStatus === "confirmed" ? parsed.data.externalReference : undefined;
    booking.updatedAt = new Date().toISOString();
    await recordAudit({
      organizationId: booking.organizationId,
      actorUserId: user.id,
      action: `booking.${nextStatus}`,
      entityType: "BookingRequest",
      entityId: id,
      metadata: { providerCompanyId, byPlatformStaff: !isProvider }
    });
    return { ...booking, devFallback: true };
  }

  app.post("/api/v1/bookings/:id/confirm", { onRequest: [app.authenticate] }, async (request, reply) =>
    confirmOrRejectBooking(request, reply, "confirmed")
  );

  app.post("/api/v1/bookings/:id/reject", { onRequest: [app.authenticate] }, async (request, reply) =>
    confirmOrRejectBooking(request, reply, "rejected")
  );

  /**
   * Lists the bookings a caller may act on: the bookings requested by their own
   * organization, plus any booking derived from a quote issued by a company they own.
   * The viewer role is computed server-side and never taken from the client.
   */
  app.get("/api/v1/bookings", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    const staff = can(user, "bookings.read");

    if (prisma) {
      const companies = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true }
      });
      const companyIds = companies.map((c: any) => c.id);
      const providerQuoteIds = companyIds.length
        ? (
            await (prisma as any).quote.findMany({
              where: { companyId: { in: companyIds } },
              select: { id: true }
            })
          ).map((q: any) => q.id)
        : [];

      const items = await (prisma as any).bookingRequest.findMany({
        where: staff
          ? {}
          : {
              OR: [
                { organizationId: user.organizationId },
                ...(providerQuoteIds.length ? [{ quoteId: { in: providerQuoteIds } }] : [])
              ]
            },
        include: { rfq: { include: { quotes: true } }, trackingEvents: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });

      return {
        items: items.map((booking: any) => {
          const quote = (booking.rfq?.quotes ?? []).find((q: any) => q.id === booking.quoteId);
          const isCustomer = booking.organizationId === user.organizationId;
          const isProvider = Boolean(quote && companyIds.includes(quote.companyId));
          return {
            ...booking,
            viewerRole: isProvider ? "provider" : isCustomer ? "customer" : "staff"
          };
        })
      };
    }

    const mine = devCompanies.filter((c) => c.organizationId === user.organizationId).map((c) => c.id);
    const myQuoteIds = devQuotesList.filter((q) => mine.includes(q.companyId)).map((q) => q.id);
    const items = devBookings
      .filter(
        (b) =>
          staff ||
          b.organizationId === user.organizationId ||
          Boolean(b.quoteId && myQuoteIds.includes(b.quoteId))
      )
      .map((b) => {
        const quote = devQuotesList.find((q) => q.id === b.quoteId);
        const isCustomer = b.organizationId === user.organizationId;
        const isProvider = Boolean(quote && mine.includes(quote.companyId));
        return {
          ...b,
          rfq: devRfqs.find((r) => r.id === b.rfqId) ?? null,
          viewerRole: isProvider ? "provider" : isCustomer ? "customer" : "staff",
          devFallback: true
        };
      });
    return { items, devFallback: true };
  });

  app.get("/api/v1/bookings/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const resolved = await bookingWithAuthority(id);
    if (!resolved) return notFound(reply);
    const { booking, providerCompanyId } = resolved;
    const isCustomer = booking.organizationId === user.organizationId;
    const isProvider = providerCompanyId
      ? await organizationOwnsCompany(user.organizationId, providerCompanyId)
      : false;
    if (!isCustomer && !isProvider && !can(user, "bookings.read")) return forbidden(reply);
    return { ...booking, viewerRole: isCustomer ? "customer" : isProvider ? "provider" : "staff" };
  });

  app.post("/api/v1/bookings/:id/tracking", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ code: z.string().min(1), label: z.string().min(1), note: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    const resolved = await bookingWithAuthority(id);
    if (!resolved) return notFound(reply);
    const { booking, providerCompanyId } = resolved;
    const isCustomer = booking.organizationId === user.organizationId;
    const isProvider = providerCompanyId
      ? await organizationOwnsCompany(user.organizationId, providerCompanyId)
      : false;
    if (!isCustomer && !isProvider && !can(user, "bookings.manage")) return forbidden(reply);

    // Manual operational updates are always labelled with their source so they are
    // never confused with trusted carrier or integration tracking events.
    const source = isProvider ? "manual-provider" : isCustomer ? "manual-customer" : "manual-staff";

    if (prisma) {
      const event = await (prisma as any).trackingEvent.create({
        data: { bookingRequestId: id, code: parsed.data.code, label: parsed.data.label, source }
      });
      return event;
    }
    const devBooking = devBookings.find((b) => b.id === id);
    if (!devBooking) return notFound(reply);
    const event = {
      id: `dev-te-${devBooking.trackingEvents.length + 1}`,
      ...parsed.data,
      source,
      occurredAt: new Date().toISOString()
    };
    devBooking.trackingEvents.push(event);
    return { ...event, devFallback: true };
  });
}

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { hasCompanyPermission, requireCompanyPermission } from "../auth/company.js";
import { loadShipmentAccess, partyAllows } from "../shipments/access.js";
import { organizationOwnsCompany } from "../companies/ownership.js";
import { recordAudit } from "../audit/log.js";
import { notify } from "../notifications/service.js";

type DevOffer = { id: string; quotationRequestId: string; providerId: string; currency: string; amount: number; transitDays: number; validityUntil: string };
type DevQuote = { id: string; shipmentId: string; organizationId: string; status: string; requestedAt: string; offers: DevOffer[] };

const devQuotes: DevQuote[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

export async function registerQuotationRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/quotations",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.financials.manage") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const parsed = z.object({ shipmentId: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const { shipmentId } = parsed.data;

      if (prisma) {
        const access = await loadShipmentAccess(user, shipmentId);
        if (!access) return reply.code(404).send({ error: "Shipment not found" });
        // Only the shipment owner may open a quotation request. A party cannot
        // create a request against another company's shipment.
        if (!access.isOwner) return forbidden(reply);
        const q = await prisma.quotationRequest.create({
          data: { shipmentId, organizationId: user.organizationId, status: "open" },
          include: { offers: true }
        });
        await prisma.shipment.update({ where: { id: shipmentId }, data: { status: "QUOTATION_REQUESTED" } });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "quotation.requested",
          entityType: "QuotationRequest",
          entityId: q.id,
          outcome: "success",
          requestId: request.id,
          metadata: { shipmentId }
        });
        return q;
      }

      const { devShipments } = await import("../shipments/routes.js");
      const shipment = devShipments.find((s: any) => s.id === shipmentId && s.organizationId === user.organizationId);
      if (!shipment) return reply.code(404).send({ error: "Shipment not found" });
      const q: DevQuote = { id: `dev-q-${devQuotes.length + 1}`, shipmentId, organizationId: user.organizationId, status: "open", requestedAt: new Date().toISOString(), offers: [] };
      devQuotes.push(q);
      return { ...q, devFallback: true };
    }
  );

  app.get(
    "/api/v1/quotations",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.financials.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (prisma) {
        const companies = await prisma.company.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true }
        });
        const companyIds = companies.map((company) => company.id);

        const [owned, partyRequests] = await Promise.all([
          prisma.quotationRequest.findMany({
            where: { organizationId: user.organizationId },
            include: { offers: true },
            orderBy: { requestedAt: "desc" },
            take: 100
          }),
          companyIds.length
            ? prisma.quotationRequest.findMany({
                where: {
                  organizationId: { not: user.organizationId },
                  shipment: {
                    parties: {
                      some: {
                        companyId: { in: companyIds },
                        canView: true,
                        OR: [{ canViewFinancials: true }, { canQuote: true }]
                      }
                    }
                  }
                },
                include: { offers: true },
                orderBy: { requestedAt: "desc" },
                take: 100
              })
            : Promise.resolve([])
        ]);

        const ownedIds = new Set(owned.map((item) => item.id));
        const items = [
          ...owned.map((item) => ({ ...item, viewerRole: "owner" as const })),
          ...partyRequests
            .filter((item) => !ownedIds.has(item.id))
            .map((item) => ({
              ...item,
              // A provider may see the request but never a competitor's bid.
              offers: item.offers.filter((offer) => companyIds.includes(offer.providerId)),
              viewerRole: "provider" as const
            }))
        ];
        return { items };
      }

      return { items: devQuotes.filter((q) => q.organizationId === user.organizationId), devFallback: true };
    }
  );

  app.get(
    "/api/v1/quotations/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("shipments.financials.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const quote = await prisma.quotationRequest.findUnique({ where: { id }, include: { offers: true } });
        if (!quote) return notFound(reply);
        const access = await loadShipmentAccess(user, quote.shipmentId);
        if (!access) return notFound(reply);

        if (access.isOwner) return { ...quote, viewerRole: "owner" };
        if (!partyAllows(access, "viewFinancials") && !partyAllows(access, "quote")) {
          return forbidden(reply);
        }
        const companies = await prisma.company.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true }
        });
        const companyIds = companies.map((company) => company.id);
        return {
          ...quote,
          offers: quote.offers.filter((offer) => companyIds.includes(offer.providerId)),
          viewerRole: "provider"
        };
      }
      const q = devQuotes.find((x) => x.id === id && x.organizationId === user.organizationId);
      if (!q) return notFound(reply);
      return { ...q, devFallback: true };
    }
  );

  const offerSchema = z.object({
    providerId: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code"),
    amount: z.number().finite().positive().max(1_000_000_000_000),
    transitDays: z.number().int().positive().max(3650),
    validityUntil: z.string().min(1)
  });

  app.post(
    "/api/v1/quotations/:id/offers",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("quotes.submit") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = offerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      const validityUntil = new Date(parsed.data.validityUntil);
      if (Number.isNaN(validityUntil.getTime()) || validityUntil.getTime() <= Date.now()) {
        return reply.code(400).send({
          error: "Offer validity must be a valid future date",
          code: "invalid_validity"
        });
      }

      // An offer must come from a provider organization that actually owns the company.
      // The requesting customer must never be able to write offers onto its own request.
      if (!(await organizationOwnsCompany(user.organizationId, parsed.data.providerId))) {
        return forbidden(reply);
      }

      if (prisma) {
        const quote = await prisma.quotationRequest.findUnique({ where: { id } });
        if (!quote) return notFound(reply);
        if (quote.status !== "open") {
          return reply.code(409).send({
            error: "Quotation is not open",
            code: "quotation_not_open",
            status: quote.status
          });
        }

        // The provider company must be a party on this shipment with the quote
        // flag. Knowing the quotation id is not enough.
        const access = await loadShipmentAccess(user, quote.shipmentId);
        if (!access || access.isOwner || !partyAllows(access, "quote")) {
          return forbidden(reply);
        }
        if (access.party?.companyId !== parsed.data.providerId) {
          return forbidden(reply);
        }

        const offer = await prisma.quotationOffer.create({
          data: {
            quotationRequestId: id,
            providerId: parsed.data.providerId,
            currency: parsed.data.currency,
            amount: parsed.data.amount,
            transitDays: parsed.data.transitDays,
            validityUntil,
            status: "submitted"
          }
        });
        await recordAudit({
          organizationId: quote.organizationId,
          actorUserId: user.id,
          action: "quotation.offer.submitted",
          entityType: "QuotationOffer",
          entityId: offer.id,
          outcome: "success",
          requestId: request.id,
          metadata: { quotationRequestId: id, providerId: parsed.data.providerId }
        });
        return offer;
      }

      const quote = devQuotes.find((q) => q.id === id);
      if (!quote) return notFound(reply);
      if (quote.status === "closed" || quote.status === "awarded") return reply.code(409).send({ error: "Quotation is not open" });
      const offer: DevOffer = { id: `dev-o-${quote.offers.length + 1}`, quotationRequestId: id, providerId: parsed.data.providerId, currency: parsed.data.currency, amount: parsed.data.amount, transitDays: parsed.data.transitDays, validityUntil: parsed.data.validityUntil };
      quote.offers.push(offer);
      return { ...offer, devFallback: true };
    }
  );

  app.post(
    "/api/v1/quotations/:id/award",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("quotes.accept") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = z.object({ offerId: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      if (prisma) {
        // Fast path for a repeated award. The database transaction below is the
        // authority for concurrency; this only returns the existing outcome.
        const existing = await prisma.quotationRequest.findUnique({
          where: { id },
          include: { offers: true }
        });
        if (!existing || existing.organizationId !== user.organizationId) return notFound(reply);
        if (existing.status === "awarded") {
          if (existing.awardedOfferId === parsed.data.offerId) {
            return { ...existing, alreadyAwarded: true };
          }
          return reply.code(409).send({
            error: "A different offer was already awarded",
            code: "quotation_already_awarded",
            awardedOfferId: existing.awardedOfferId
          });
        }
        if (existing.status !== "open") {
          return reply.code(409).send({
            error: "Quotation is not open",
            code: "quotation_not_open",
            status: existing.status
          });
        }

        const offer = existing.offers.find((candidate) => candidate.id === parsed.data.offerId);
        if (!offer) return reply.code(404).send({ error: "Offer not found" });
        if (offer.status !== "submitted") {
          return reply.code(409).send({
            error: `Offer is ${offer.status} and cannot be awarded`,
            code: "offer_not_awardable"
          });
        }
        if (offer.validityUntil.getTime() <= Date.now()) {
          return reply.code(409).send({
            error: "The offer has expired",
            code: "offer_expired",
            validityUntil: offer.validityUntil
          });
        }

        let updated: any;
        try {
          updated = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
            const current = await tx.quotationRequest.findUnique({
              where: { id },
              include: { offers: true }
            });
            if (!current || current.organizationId !== user.organizationId) return null;
            if (current.status === "awarded") {
              if (current.awardedOfferId === parsed.data.offerId) {
                return { ...current, alreadyAwarded: true };
              }
              throw Object.assign(new Error("quotation_already_awarded"), {
                code: "quotation_already_awarded"
              });
            }
            if (current.status !== "open") {
              throw Object.assign(new Error("quotation_not_open"), { code: "quotation_not_open" });
            }
            const winning = current.offers.find((candidate) => candidate.id === parsed.data.offerId);
            if (!winning) throw Object.assign(new Error("offer_not_found"), { code: "offer_not_found" });
            if (winning.status !== "submitted") {
              throw Object.assign(new Error("offer_not_awardable"), { code: "offer_not_awardable" });
            }
            if (winning.validityUntil.getTime() <= Date.now()) {
              throw Object.assign(new Error("offer_expired"), { code: "offer_expired" });
            }

            await tx.quotationOffer.update({
              where: { id: winning.id },
              data: { status: "awarded", decidedAt: new Date(), decidedByUserId: user.id }
            });
            await tx.quotationOffer.updateMany({
              where: {
                quotationRequestId: id,
                id: { not: winning.id },
                status: "submitted"
              },
              data: {
                status: "rejected",
                decidedAt: new Date(),
                decidedByUserId: user.id,
                rejectionReason: "Another offer was awarded."
              }
            });
            const awarded = await tx.quotationRequest.update({
              where: { id },
              data: {
                status: "awarded",
                awardedOfferId: winning.id,
                awardedAt: new Date(),
                awardedByUserId: user.id,
                closedAt: new Date()
              },
              include: { offers: true }
            });
            await tx.shipment.updateMany({
              where: { id: current.shipmentId, status: { in: ["DRAFT", "QUOTATION_REQUESTED"] } },
              data: { status: "QUOTED" }
            });
            return awarded;
          });
        } catch (error: any) {
          const code = error?.code;
          if (code === "quotation_already_awarded") {
            const row = await prisma.quotationRequest.findUnique({ where: { id } });
            return reply.code(409).send({
              error: "A different offer was already awarded",
              code,
              awardedOfferId: row?.awardedOfferId
            });
          }
          if (code === "offer_expired") {
            return reply.code(409).send({ error: "The offer has expired", code });
          }
          if (code === "offer_not_awardable" || code === "quotation_not_open") {
            return reply.code(409).send({ error: "The offer cannot be awarded", code });
          }
          throw error;
        }
        if (!updated) return notFound(reply);

        if (!updated.alreadyAwarded) {
          await recordAudit({
            organizationId: user.organizationId,
            actorUserId: user.id,
            action: "quotation.awarded",
            entityType: "QuotationRequest",
            entityId: id,
            outcome: "success",
            requestId: request.id,
            metadata: { offerId: offer.id, providerId: offer.providerId }
          });
          const company = await prisma.company.findUnique({ where: { id: offer.providerId } });
          if (company?.organizationId) {
            await notify({
              organizationId: company.organizationId,
              type: "QUOTATION_ACCEPTED",
              title: "تم قبول عرضك",
              body: `تم قبول عرضك على الشحنة.`,
              dedupeKey: `quotation-awarded:${id}:${offer.id}`,
              entityType: "QuotationRequest",
              entityId: id
            });
          }
          const rejectedOffers = await prisma.quotationOffer.findMany({
            where: { quotationRequestId: id, status: "rejected" },
            select: { id: true, providerId: true }
          });
          for (const rejectedOffer of rejectedOffers) {
            if (rejectedOffer.id === offer.id) continue;
            const rejectedCompany = await prisma.company.findUnique({
              where: { id: rejectedOffer.providerId },
              select: { organizationId: true }
            });
            if (rejectedCompany?.organizationId) {
              await notify({
                organizationId: rejectedCompany.organizationId,
                type: "QUOTATION_REJECTED",
                title: "لم يتم اختيار عرضك",
                body: "تم اختيار عرض آخر على الشحنة.",
                dedupeKey: `quotation-rejected:${id}:${rejectedOffer.id}`,
                entityType: "QuotationOffer",
                entityId: rejectedOffer.id,
                severity: "warning"
              });
            }
          }
        }
        return updated;
      }

      const quote = devQuotes.find((q) => q.id === id && q.organizationId === user.organizationId);
      if (!quote) return notFound(reply);
      if (quote.status !== "open") return reply.code(409).send({ error: "Quotation is not open", code: "quotation_not_open" });
      const offer = quote.offers.find((o) => o.id === parsed.data.offerId);
      if (!offer) return reply.code(404).send({ error: "Offer not found" });
      if (new Date(offer.validityUntil).getTime() <= Date.now()) {
        return reply.code(409).send({ error: "The offer has expired", code: "offer_expired" });
      }
      quote.status = "awarded";
      return { ...quote, awardedOfferId: offer.id, devFallback: true };
    }
  );

  app.post(
    "/api/v1/quotations/:id/offers/:offerId/withdraw",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("quotes.submit") },
    async (request, reply) => {
      if (!prisma) {
        const user = getAuthUser(request);
        const { id, offerId } = request.params as { id: string; offerId: string };
        const quote = devQuotes.find((candidate) => candidate.id === id && candidate.organizationId === user.organizationId);
        if (!quote) return notFound(reply);
        const offer = quote.offers.find((candidate) => candidate.id === offerId);
        if (!offer) return notFound(reply);
        return { ...offer, status: "withdrawn", devFallback: true };
      }
      const user = getAuthUser(request);
      const { id, offerId } = request.params as { id: string; offerId: string };
      const offer = await prisma.quotationOffer.findFirst({
        where: { id: offerId, quotationRequestId: id }
      });
      if (!offer) return notFound(reply);
      if (!(await organizationOwnsCompany(user.organizationId, offer.providerId))) {
        return forbidden(reply);
      }
      if (offer.status !== "submitted") {
        return reply.code(409).send({ error: `Offer is ${offer.status}`, code: "offer_not_withdrawable" });
      }
      const updated = await prisma.quotationOffer.update({
        where: { id: offerId },
        data: { status: "withdrawn", withdrawnAt: new Date(), decidedAt: new Date(), decidedByUserId: user.id }
      });
      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "quotation.offer.withdrawn",
        entityType: "QuotationOffer",
        entityId: offerId,
        outcome: "success",
        requestId: request.id,
        metadata: { quotationRequestId: id }
      });
      return updated;
    }
  );

  app.post(
    "/api/v1/quotations/:id/offers/:offerId/reject",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("quotes.accept") },
    async (request, reply) => {
      if (!prisma) return reply.code(503).send({ error: "Database required", code: "database_required" });
      const user = getAuthUser(request);
      const { id, offerId } = request.params as { id: string; offerId: string };
      const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const requestRow = await prisma.quotationRequest.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!requestRow) return notFound(reply);
      const offer = await prisma.quotationOffer.findFirst({ where: { id: offerId, quotationRequestId: id } });
      if (!offer) return notFound(reply);
      if (offer.status !== "submitted") {
        return reply.code(409).send({ error: `Offer is ${offer.status}`, code: "offer_not_rejectable" });
      }
      const updated = await prisma.quotationOffer.update({
        where: { id: offerId },
        data: {
          status: "rejected",
          decidedAt: new Date(),
          decidedByUserId: user.id,
          rejectionReason: parsed.data.reason ?? null
        }
      });
      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "quotation.offer.rejected",
        entityType: "QuotationOffer",
        entityId: offerId,
        outcome: "success",
        requestId: request.id,
        metadata: { quotationRequestId: id, reason: parsed.data.reason ?? null }
      });
      return updated;
    }
  );
}

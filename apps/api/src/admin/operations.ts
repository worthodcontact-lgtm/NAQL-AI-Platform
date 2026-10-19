import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { listQuerySchema, pageResult, pagination, parseDate, requirePermission, sendError } from "./shared.js";

const dateParam = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

const shipmentsQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(40).optional(),
  mode: z.string().trim().max(40).optional(),
  incoterm: z.string().trim().max(20).optional(),
  organizationId: z.string().trim().max(64).optional(),
  createdFrom: dateParam,
  createdTo: dateParam
});

const bookingsQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(40).optional(),
  organizationId: z.string().trim().max(64).optional(),
  createdFrom: dateParam,
  createdTo: dateParam
});

const rfqsQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(40).optional(),
  organizationId: z.string().trim().max(64).optional(),
  createdFrom: dateParam,
  createdTo: dateParam
});

const quotesQuerySchema = listQuerySchema.extend({
  status: z.string().trim().max(40).optional(),
  companyId: z.string().trim().max(64).optional(),
  organizationId: z.string().trim().max(64).optional(),
  createdFrom: dateParam,
  createdTo: dateParam
});

function dateRange(from?: string, to?: string) {
  const range: any = {};
  const start = parseDate(from);
  const end = parseDate(to, true);
  if (start) range.gte = start;
  if (end) range.lte = end;
  return Object.keys(range).length ? range : undefined;
}

export async function registerAdminOperationRoutes(app: FastifyInstance) {
  const db = () => prisma!;

  // ----------------------------------------------------------------- shipments
  app.get("/api/v1/admin/shipments", { onRequest: [app.authenticate], preHandler: requirePermission("shipments.read") }, async (request, reply) => {
    const parsed = shipmentsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, status, mode, incoterm, organizationId } = parsed.data;
    const p = pagination(parsed.data);

    const where: any = {};
    if (status) where.status = status;
    if (mode) where.mode = mode;
    if (incoterm) where.incoterm = incoterm;
    if (organizationId) where.organizationId = organizationId;
    const created = dateRange(parsed.data.createdFrom, parsed.data.createdTo);
    if (created) where.createdAt = created;
    if (q) {
      where.OR = [
        { reference: { contains: q, mode: "insensitive" } },
        { cargoDescription: { contains: q, mode: "insensitive" } }
      ];
    }

    const [items, total] = await Promise.all([
      db().shipment.findMany({
        where,
        select: {
          id: true,
          reference: true,
          organizationId: true,
          organization: { select: { id: true, name: true } },
          mode: true,
          incoterm: true,
          status: true,
          cargoDescription: true,
          weightKg: true,
          volumeCbm: true,
          createdAt: true,
          updatedAt: true,
          originPort: { select: { id: true, code: true, name: true, country: true } },
          destinationPort: { select: { id: true, code: true, name: true, country: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take
      }),
      db().shipment.count({ where })
    ]);

    return pageResult(items, total, p);
  });

  app.get("/api/v1/admin/shipments/:id", { onRequest: [app.authenticate], preHandler: requirePermission("shipments.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const shipment = await db().shipment.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        organizationId: true,
        organization: { select: { id: true, name: true, slug: true } },
        createdByUserId: true,
        mode: true,
        incoterm: true,
        status: true,
        cargoDescription: true,
        weightKg: true,
        volumeCbm: true,
        createdAt: true,
        updatedAt: true,
        originPort: true,
        destinationPort: true,
        milestones: { orderBy: { occurredAt: "asc" } },
        documents: {
          select: { id: true, type: true, filename: true, status: true, validation: true, uploadedAt: true },
          orderBy: { uploadedAt: "desc" }
        },
        quotationRequests: {
          select: {
            id: true,
            status: true,
            requestedAt: true,
            offers: { select: { id: true, providerId: true, currency: true, amount: true, transitDays: true, validityUntil: true } }
          },
          orderBy: { requestedAt: "desc" }
        }
      }
    });
    if (!shipment) return sendError(reply, 404, "shipment_not_found", "Shipment not found");
    return { shipment };
  });

  // ------------------------------------------------------------------ bookings
  app.get("/api/v1/admin/bookings", { onRequest: [app.authenticate], preHandler: requirePermission("bookings.read") }, async (request, reply) => {
    const parsed = bookingsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, status, organizationId } = parsed.data;
    const p = pagination(parsed.data);

    const where: any = {};
    if (status) where.status = status;
    if (organizationId) where.organizationId = organizationId;
    const created = dateRange(parsed.data.createdFrom, parsed.data.createdTo);
    if (created) where.createdAt = created;
    if (q) {
      const matchingOrganizations = await db().organization.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        select: { id: true },
        take: 100
      });
      where.OR = [
        { externalReference: { contains: q, mode: "insensitive" } },
        { rfq: { origin: { contains: q, mode: "insensitive" } } },
        { rfq: { destination: { contains: q, mode: "insensitive" } } },
        { quote: { company: { name: { contains: q, mode: "insensitive" } } } },
        ...(matchingOrganizations.length
          ? [{ organizationId: { in: matchingOrganizations.map((organization) => organization.id) } }]
          : [])
      ];
    }

    const [items, total] = await Promise.all([
      db().bookingRequest.findMany({
        where,
        select: {
          id: true,
          status: true,
          organizationId: true,
          createdByUserId: true,
          quoteId: true,
          confirmedAt: true,
          externalReference: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          rfq: { select: { id: true, origin: true, destination: true, mode: true, status: true } },
          quote: {
            select: {
              id: true,
              currency: true,
              totalAmount: true,
              transitDays: true,
              validityUntil: true,
              status: true,
              company: { select: { id: true, name: true, verificationStatus: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take
      }),
      db().bookingRequest.count({ where })
    ]);

    // BookingRequest has no relation field to Organization; resolve names in a
    // single bounded lookup instead of widening the schema for a display label.
    const organizationIds = [...new Set(items.map((item) => item.organizationId))];
    const organizations = organizationIds.length
      ? await db().organization.findMany({
          where: { id: { in: organizationIds } },
          select: { id: true, name: true }
        })
      : [];
    const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));

    return pageResult(
      items.map((item) => ({ ...item, organization: organizationById.get(item.organizationId) ?? null })),
      total,
      p
    );
  });

  app.get("/api/v1/admin/bookings/:id", { onRequest: [app.authenticate], preHandler: requirePermission("bookings.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const booking = await db().bookingRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        organizationId: true,
        createdByUserId: true,
        confirmedAt: true,
        externalReference: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
        rfq: {
          select: {
            id: true,
            origin: true,
            destination: true,
            mode: true,
            status: true,
            cargoDescription: true,
            weightKg: true,
            organizationId: true,
            createdAt: true
          }
        },
        quote: {
          select: {
            id: true,
            currency: true,
            totalAmount: true,
            transitDays: true,
            validityUntil: true,
            status: true,
            createdAt: true,
            company: { select: { id: true, name: true, type: true, verificationStatus: true } },
            items: true
          }
        },
        trackingEvents: { orderBy: { occurredAt: "desc" } }
      }
    });
    if (!booking) return sendError(reply, 404, "booking_not_found", "Booking not found");

    const organization = await db().organization.findUnique({
      where: { id: booking.organizationId },
      select: { id: true, name: true, slug: true }
    });

    return { booking, organization };
  });

  // ---------------------------------------------------------------------- RFQs
  app.get("/api/v1/admin/rfqs", { onRequest: [app.authenticate], preHandler: requirePermission("rfqs.read") }, async (request, reply) => {
    const parsed = rfqsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, status, organizationId } = parsed.data;
    const p = pagination(parsed.data);

    const where: any = {};
    if (status) where.status = status;
    if (organizationId) where.organizationId = organizationId;
    const created = dateRange(parsed.data.createdFrom, parsed.data.createdTo);
    if (created) where.createdAt = created;
    if (q) {
      const matchingOrganizations = await db().organization.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        select: { id: true },
        take: 100
      });
      where.OR = [
        { origin: { contains: q, mode: "insensitive" } },
        { destination: { contains: q, mode: "insensitive" } },
        { cargoDescription: { contains: q, mode: "insensitive" } },
        ...(matchingOrganizations.length
          ? [{ organizationId: { in: matchingOrganizations.map((organization) => organization.id) } }]
          : [])
      ];
    }

    const [items, total] = await Promise.all([
      db().rfq.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          createdByUserId: true,
          origin: true,
          destination: true,
          mode: true,
          cargoDescription: true,
          weightKg: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { quotes: true, recipients: true, bookings: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take
      }),
      db().rfq.count({ where })
    ]);

    const organizationIds = [...new Set(items.map((item) => item.organizationId))];
    const organizations = organizationIds.length
      ? await db().organization.findMany({
          where: { id: { in: organizationIds } },
          select: { id: true, name: true }
        })
      : [];
    const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));

    return pageResult(
      items.map((item) => ({ ...item, organization: organizationById.get(item.organizationId) ?? null })),
      total,
      p
    );
  });

  app.get("/api/v1/admin/rfqs/:id", { onRequest: [app.authenticate], preHandler: requirePermission("rfqs.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rfq = await db().rfq.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        createdByUserId: true,
        origin: true,
        destination: true,
        mode: true,
        cargoDescription: true,
        weightKg: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        recipients: {
          select: {
            id: true,
            status: true,
            invitedAt: true,
            company: { select: { id: true, name: true, type: true, verificationStatus: true } }
          }
        },
        quotes: {
          select: {
            id: true,
            currency: true,
            totalAmount: true,
            transitDays: true,
            validityUntil: true,
            status: true,
            createdAt: true,
            company: { select: { id: true, name: true, verificationStatus: true } },
            organizationId: true,
            items: true
          },
          orderBy: { createdAt: "desc" }
        },
        bookings: {
          select: { id: true, status: true, createdAt: true, confirmedAt: true, externalReference: true },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    if (!rfq) return sendError(reply, 404, "rfq_not_found", "RFQ not found");

    const organization = await db().organization.findUnique({
      where: { id: rfq.organizationId },
      select: { id: true, name: true, slug: true }
    });

    return { rfq, organization };
  });

  // ---------------------------------------------------------------- quotations
  app.get("/api/v1/admin/quotations", { onRequest: [app.authenticate], preHandler: requirePermission("quotations.read") }, async (request, reply) => {
    const parsed = quotesQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, status, companyId, organizationId } = parsed.data;
    const p = pagination(parsed.data);

    const where: any = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (organizationId) where.organizationId = organizationId;
    const created = dateRange(parsed.data.createdFrom, parsed.data.createdTo);
    if (created) where.createdAt = created;
    if (q) {
      where.OR = [
        { company: { name: { contains: q, mode: "insensitive" } } },
        { rfq: { origin: { contains: q, mode: "insensitive" } } },
        { rfq: { destination: { contains: q, mode: "insensitive" } } }
      ];
    }

    const [items, total] = await Promise.all([
      db().quote.findMany({
        where,
        select: {
          id: true,
          rfqId: true,
          companyId: true,
          organizationId: true,
          currency: true,
          totalAmount: true,
          transitDays: true,
          validityUntil: true,
          status: true,
          createdAt: true,
          company: { select: { id: true, name: true, type: true, verificationStatus: true } },
          rfq: { select: { id: true, origin: true, destination: true, mode: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take
      }),
      db().quote.count({ where })
    ]);

    return pageResult(items, total, p);
  });

  app.get("/api/v1/admin/quotations/:id", { onRequest: [app.authenticate], preHandler: requirePermission("quotations.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const quote = await db().quote.findUnique({
      where: { id },
      select: {
        id: true,
        rfqId: true,
        organizationId: true,
        currency: true,
        totalAmount: true,
        transitDays: true,
        validityUntil: true,
        status: true,
        createdAt: true,
        company: { select: { id: true, name: true, type: true, verificationStatus: true, country: true } },
        items: true,
        rfq: {
          select: {
            id: true,
            organizationId: true,
            origin: true,
            destination: true,
            mode: true,
            status: true,
            cargoDescription: true,
            weightKg: true,
            createdAt: true
          }
        },
        bookings: { select: { id: true, status: true, createdAt: true, confirmedAt: true, externalReference: true } }
      }
    });
    if (!quote) return sendError(reply, 404, "quotation_not_found", "Quotation not found");

    const rfqOrganization = quote.rfq?.organizationId
      ? await db().organization.findUnique({
          where: { id: quote.rfq.organizationId },
          select: { id: true, name: true }
        })
      : null;

    return { quote, rfqOrganization };
  });
}

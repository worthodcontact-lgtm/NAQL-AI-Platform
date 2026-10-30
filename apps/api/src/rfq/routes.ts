import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { can, isPlatformStaff } from "../auth/roles.js";
import {
  hasCompanyPermission,
  requireCompanyPermission,
  requireProviderOrganization
} from "../auth/company.js";
import { recordAudit } from "../audit/log.js";
import { organizationOwnsCompany } from "../companies/ownership.js";
import { companyCanServeMode, devCompanies } from "../companies/routes.js";
import { notify } from "../notifications/service.js";
import { validateEventTransition, SHIPMENT_EVENT_DEFINITIONS } from "../shipments/state.js";
import { MAX_DOCUMENT_BYTES } from "../config/env.js";
import {
  createStorageKey,
  extensionForFilename,
  sanitizeDisplayFilename,
  storageAdapter
} from "../storage/adapter.js";
import { FileValidationError, validateFileContent } from "../documents/content.js";
import { scanUpload } from "../documents/malware.js";
import { contentHash } from "../documents/storage-policy.js";

type DevRfq = {
  id: string; organizationId: string; createdByUserId: string; origin: string; destination: string;
  originPortId?: string; destinationPortId?: string; incoterm?: string; shipmentId?: string;
  mode: string; cargoDescription: string; weightKg: number; volumeCbm?: number;
  packageCount?: number; containerCount?: number; containerType?: string; requiredService?: string;
  preferredPickupDate?: string; preferredDeliveryDate?: string; latestDeliveryDate?: string;
  cargoValue?: number; cargoCurrency?: string; isHazardous?: boolean; specialRequirements?: string;
  discoveryMode?: string; status: string; cancelledAt?: string; cancelledByUserId?: string;
  cancellationReason?: string; createdAt: string; updatedAt: string; recipients: any[];
};
type DevQuote = {
  id: string; rfqId: string; companyId: string; organizationId: string; currency: string;
  totalAmount: number; transitDays: number; validityUntil: string; status: string;
  pricingSource?: string; priceConfidence?: string; revisionNumber?: number;
  supersedesQuoteId?: string; notes?: string; terms?: string; serviceDetails?: string;
  routeDetails?: string; unknownCharges?: string[]; excludedServices?: string[];
  submittedByUserId?: string; createdAt: string; items: any[];
};
type DevBooking = { id: string; rfqId?: string; quoteId?: string; organizationId: string; createdByUserId: string; status: string; confirmedAt?: string; externalReference?: string; createdAt: string; updatedAt: string; trackingEvents: any[] };

export const devRfqs: DevRfq[] = [];
export const devQuotesList: DevQuote[] = [];
export const devBookings: DevBooking[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

const QUOTE_PRICING_SOURCES = [
  "provider_submitted",
  "published_tariff",
  "estimated",
  "calculated",
  "contracted"
] as const;
const QUOTE_PRICE_CONFIDENCE = ["indicative", "estimated", "confirmed"] as const;
const QUOTE_CHARGE_TYPES = ["freight", "surcharge", "fee", "service", "tax", "other"] as const;

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** A quote view that exposes known, excluded and unknown amounts separately. */
function quoteView(quote: any) {
  if (!quote) return quote;
  const items = quote.items ?? [];
  const includedItems = items.filter((item: any) => item.included !== false && item.optional !== true);
  const excludedItems = items.filter((item: any) => item.included === false || item.optional === true);
  const knownSubtotal = includedItems.reduce((sum: number, item: any) => sum + asNumber(item.amount), 0);
  const excludedSubtotal = excludedItems.reduce((sum: number, item: any) => sum + asNumber(item.amount), 0);
  const hasEstimatedComponents =
    ["estimated", "calculated"].includes(quote.pricingSource) ||
    items.some((item: any) => ["estimated", "calculated"].includes(item.pricingSource));
  const hasUnknownCharges = Array.isArray(quote.unknownCharges) && quote.unknownCharges.length > 0;
  return {
    ...quote,
    items: items.map((item: any) => ({
      ...item,
      amount: asNumber(item.amount),
      chargeType: item.chargeType ?? "other",
      pricingSource: item.pricingSource ?? quote.pricingSource ?? "provider_submitted",
      priceConfidence: item.priceConfidence ?? quote.priceConfidence ?? "indicative"
    })),
    totalAmount: asNumber(quote.totalAmount),
    knownSubtotal,
    excludedSubtotal,
    hasEstimatedComponents,
    hasUnknownCharges,
    priceDisplayStatus: hasEstimatedComponents
      ? "estimated"
      : quote.pricingSource === "published_tariff"
        ? "published_tariff"
        : quote.pricingSource === "contracted"
          ? "provider_stated_contracted"
          : "provider_submitted"
  };
}

function rfqViewForProvider(rfq: any, companyIds: Set<string>) {
  if (!rfq) return rfq;
  const {
    organizationId: _organizationId,
    createdByUserId: _createdByUserId,
    cancelledByUserId: _cancelledByUserId,
    recipients,
    bookings: _bookings,
    documents,
    ...rest
  } = rfq;
  return {
    ...rest,
    ...(Array.isArray(recipients)
      ? { recipients: recipients.filter((recipient: any) => companyIds.has(recipient.companyId)) }
      : {}),
    ...(Array.isArray(documents)
      ? { documents: documents.filter((document: any) => document.visibility === "providers").map(documentView) }
      : {}),
    quotes: (rfq.quotes ?? []).filter((quote: any) => companyIds.has(quote.companyId)).map(quoteView)
  };
}

function documentView(document: any) {
  return {
    id: document.id,
    rfqId: document.rfqId,
    type: document.type,
    filename: document.filename,
    contentType: document.contentType ?? null,
    size: document.size ?? null,
    contentHash: document.contentHash ?? null,
    malwareScanStatus: document.malwareScanStatus ?? "not_scanned",
    visibility: document.visibility,
    status: document.status,
    uploadedAt: document.uploadedAt,
    hasContent: document.status !== "metadata_only"
  };
}

async function ownedCompanies(organizationId: string) {
  if (prisma) {
    return prisma.company.findMany({
      where: {
        organizationId,
        status: { notIn: ["suspended", "rejected"] },
        verificationStatus: { not: "rejected" }
      },
      select: {
        id: true, name: true, type: true, listed: true, organizationId: true,
        services: { select: { mode: true, serviceType: true } }
      }
    });
  }
  return devCompanies
    .filter((company) => company.organizationId === organizationId)
    .map((company) => ({
      id: company.id,
      name: company.name,
      type: company.type,
      listed: company.listed,
      organizationId: company.organizationId,
      services: (company.services ?? []).map((service: any) => ({
        mode: service.mode,
        serviceType: service.serviceType ?? null
      }))
    }));
}

async function notifyInvitedCompanies(
  companyIds: string[],
  input: {
    type: "RFQ_SUBMITTED" | "RFQ_CANCELLED";
    title: string;
    body: string;
    dedupeKey: string;
    rfqId: string;
  }
) {
  if (!prisma || companyIds.length === 0) return;
  const companies = await prisma.company.findMany({
    where: { id: { in: [...new Set(companyIds)] }, organizationId: { not: null } },
    select: { organizationId: true }
  });
  for (const organizationId of new Set(companies.map((company) => company.organizationId!).filter(Boolean))) {
    await notify({
      organizationId,
      type: input.type,
      title: input.title,
      body: input.body,
      dedupeKey: `${input.dedupeKey}:${organizationId}`,
      entityType: "Rfq",
      entityId: input.rfqId
    });
  }
}

/** Provider-side authorization: the caller must own the company on the quote. */
async function ownsCompanyDb(organizationId: string, companyId: string) {
  return organizationOwnsCompany(organizationId, companyId);
}

/** Shape a booking for the provider that owns the accepted quote. */
function bookingViewForProvider(booking: any, companyIds: Set<string>) {
  const { organizationId: _organizationId, createdByUserId: _createdByUserId, rfq, ...rest } = booking;
  return {
    ...rest,
    ...(rfq ? { rfq: rfqViewForProvider(rfq, companyIds) } : {})
  };
}

export async function registerRfqRoutes(app: FastifyInstance) {
  const createSchema = z.object({
    origin: z.string().trim().min(2).max(200),
    destination: z.string().trim().min(2).max(200),
    originPortId: z.string().min(1).optional(),
    destinationPortId: z.string().min(1).optional(),
    mode: z.enum(["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"]),
    incoterm: z.enum(["EXW", "FCA", "FOB", "CFR", "CIF", "DAP", "DDP"]).optional(),
    cargoDescription: z.string().trim().min(3).max(4000),
    weightKg: z.number().positive().max(1_000_000_000_000),
    volumeCbm: z.number().positive().max(1_000_000_000).optional(),
    packageCount: z.number().int().positive().max(10_000_000).optional(),
    containerCount: z.number().int().positive().max(100_000).optional(),
    containerType: z.string().trim().max(50).optional(),
    requiredService: z.string().trim().max(200).optional(),
    preferredPickupDate: z.string().min(1).optional(),
    preferredDeliveryDate: z.string().min(1).optional(),
    latestDeliveryDate: z.string().min(1).optional(),
    cargoValue: z.number().nonnegative().max(1_000_000_000_000_000).optional(),
    cargoCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
    isHazardous: z.boolean().optional(),
    specialRequirements: z.string().trim().max(4000).optional(),
    discoveryMode: z.enum(["invited", "marketplace"]).optional(),
    status: z.enum(["draft", "submitted"]).optional(),
    recipientCompanyIds: z.array(z.string().min(1)).max(50).optional()
  }).superRefine((input, ctx) => {
    const routeFields = [input.originPortId, input.destinationPortId, input.incoterm];
    if (routeFields.some(Boolean) && !routeFields.every(Boolean)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "originPortId, destinationPortId, and incoterm must be supplied together",
        path: ["originPortId"]
      });
    }
    if (Boolean(input.cargoValue) !== Boolean(input.cargoCurrency)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "cargoValue and cargoCurrency must be supplied together",
        path: ["cargoCurrency"]
      });
    }
    const dates = [
      ["preferredPickupDate", input.preferredPickupDate],
      ["preferredDeliveryDate", input.preferredDeliveryDate],
      ["latestDeliveryDate", input.latestDeliveryDate]
    ] as const;
    for (const [field, value] of dates) {
      if (value && Number.isNaN(new Date(value).getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date", path: [field] });
      }
    }
    if (
      input.preferredPickupDate &&
      input.preferredDeliveryDate &&
      new Date(input.preferredDeliveryDate).getTime() < new Date(input.preferredPickupDate).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "preferredDeliveryDate cannot precede preferredPickupDate",
        path: ["preferredDeliveryDate"]
      });
    }
    if (
      input.preferredDeliveryDate &&
      input.latestDeliveryDate &&
      new Date(input.latestDeliveryDate).getTime() < new Date(input.preferredDeliveryDate).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "latestDeliveryDate cannot precede preferredDeliveryDate",
        path: ["latestDeliveryDate"]
      });
    }
    if (input.recipientCompanyIds) {
      input.recipientCompanyIds = [...new Set(input.recipientCompanyIds)];
    }
  });

  app.post("/api/v1/rfqs", { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.create") }, async (request, reply) => {
    const user = getAuthUser(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (prisma) {
      let route: { origin: string; destination: string; originPortId?: string; destinationPortId?: string } = {
        origin: input.origin,
        destination: input.destination
      };
      if (input.originPortId && input.destinationPortId && input.incoterm) {
        const [originPort, destinationPort] = await Promise.all([
          prisma.port.findFirst({
            where: { OR: [{ id: input.originPortId }, { code: input.originPortId }] }
          }),
          prisma.port.findFirst({
            where: { OR: [{ id: input.destinationPortId }, { code: input.destinationPortId }] }
          })
        ]);
        if (!originPort || !destinationPort || originPort.id === destinationPort.id) {
          return reply.code(400).send({
            error: "Choose two different ports from the reference directory",
            code: "invalid_rfq_ports"
          });
        }
        const isCompatible = (type: string) =>
          input.mode === "SEA" ? type === "seaport" :
          input.mode === "AIR" ? type === "airport" : true;
        if (!isCompatible(originPort.type) || !isCompatible(destinationPort.type)) {
          return reply.code(400).send({
            error: "The selected port types do not match the requested transport mode",
            code: "rfq_port_mode_mismatch"
          });
        }
        route = {
          origin: originPort.name,
          destination: destinationPort.name,
          originPortId: originPort.id,
          destinationPortId: destinationPort.id
        };
      }

      const recipientIds = [...new Set(input.recipientCompanyIds ?? [])];
      if (recipientIds.length > 0) {
        const recipients = await prisma.company.findMany({
          where: {
            id: { in: recipientIds },
            type: { not: "importer_exporter" },
            status: { notIn: ["suspended", "rejected"] },
            verificationStatus: { not: "rejected" }
          },
          select: { id: true, organizationId: true }
        });
        if (recipients.length !== recipientIds.length) {
          return reply.code(400).send({
            error: "One or more RFQ recipients are not eligible provider companies",
            code: "invalid_rfq_recipient"
          });
        }
        if (recipients.some((company) => company.organizationId === user.organizationId)) {
          return reply.code(400).send({
            error: "An RFQ cannot be addressed to the requesting organization",
            code: "self_recipient_not_allowed"
          });
        }
      }

      const status = input.status ?? "submitted";
      const discoveryMode = input.discoveryMode ?? "invited";
      const rfq = await prisma.rfq.create({
        data: {
          organizationId: user.organizationId,
          createdByUserId: user.id,
          origin: route.origin,
          destination: route.destination,
          originPortId: route.originPortId,
          destinationPortId: route.destinationPortId,
          mode: input.mode,
          incoterm: input.incoterm,
          cargoDescription: input.cargoDescription,
          weightKg: input.weightKg,
          volumeCbm: input.volumeCbm,
          packageCount: input.packageCount,
          containerCount: input.containerCount,
          containerType: input.containerType,
          requiredService: input.requiredService,
          preferredPickupDate: input.preferredPickupDate ? new Date(input.preferredPickupDate) : undefined,
          preferredDeliveryDate: input.preferredDeliveryDate ? new Date(input.preferredDeliveryDate) : undefined,
          latestDeliveryDate: input.latestDeliveryDate ? new Date(input.latestDeliveryDate) : undefined,
          cargoValue: input.cargoValue,
          cargoCurrency: input.cargoCurrency,
          isHazardous: input.isHazardous ?? false,
          specialRequirements: input.specialRequirements,
          discoveryMode,
          status,
          recipients: recipientIds.length
            ? { create: recipientIds.map((companyId) => ({ companyId })) }
            : undefined
        },
        include: { recipients: true, quotes: true, documents: true }
      });
      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: status === "draft" ? "rfq.draft" : "rfq.create",
        entityType: "Rfq",
        entityId: rfq.id,
        requestId: request.id,
        metadata: {
          mode: input.mode,
          status,
          discoveryMode,
          recipientCount: recipientIds.length
        }
      });
      if (status === "submitted") {
        await notifyInvitedCompanies(recipientIds, {
          type: "RFQ_SUBMITTED",
          title: "طلب عرض جديد",
          body: `وصلك طلب عرض جديد بمسار ${rfq.origin} → ${rfq.destination}.`,
          dedupeKey: `rfq-submitted:${rfq.id}`,
          rfqId: rfq.id
        });
      }
      return rfq;
    }

    const status = input.status ?? "submitted";
    const rfq: DevRfq = {
      id: `dev-rfq-${devRfqs.length + 1}`,
      organizationId: user.organizationId,
      createdByUserId: user.id,
      origin: input.origin,
      destination: input.destination,
      originPortId: input.originPortId,
      destinationPortId: input.destinationPortId,
      incoterm: input.incoterm,
      mode: input.mode,
      cargoDescription: input.cargoDescription,
      weightKg: input.weightKg,
      volumeCbm: input.volumeCbm,
      packageCount: input.packageCount,
      containerCount: input.containerCount,
      containerType: input.containerType,
      requiredService: input.requiredService,
      preferredPickupDate: input.preferredPickupDate,
      preferredDeliveryDate: input.preferredDeliveryDate,
      latestDeliveryDate: input.latestDeliveryDate,
      cargoValue: input.cargoValue,
      cargoCurrency: input.cargoCurrency,
      isHazardous: input.isHazardous ?? false,
      specialRequirements: input.specialRequirements,
      discoveryMode: input.discoveryMode ?? "invited",
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      recipients: (input.recipientCompanyIds ?? []).map((companyId, i) => ({ id: `dev-recipient-${i + 1}`, companyId, status: "invited" }))
    };
    devRfqs.push(rfq);
    await recordAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: status === "draft" ? "rfq.draft" : "rfq.create",
      entityType: "Rfq",
      entityId: rfq.id,
      metadata: { status, discoveryMode: rfq.discoveryMode }
    });
    return { ...rfq, devFallback: true };
  });

  app.get("/api/v1/rfqs", { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.read") }, async (request) => {
    const user = getAuthUser(request);
    if (prisma) {
      const items = await prisma.rfq.findMany({
        where: { organizationId: user.organizationId },
        include: { recipients: true, quotes: { include: { items: true } }, documents: true },
        orderBy: { createdAt: "desc" },
        take: 100
      });
      return {
        items: items.map((rfq) => ({
          ...rfq,
          quotes: rfq.quotes.map(quoteView),
          documents: rfq.documents.map(documentView)
        }))
      };
    }
    return {
      items: devRfqs
        .filter((r) => r.organizationId === user.organizationId)
        .map((rfq) => ({
          ...rfq,
          quotes: devQuotesList.filter((quote) => quote.rfqId === rfq.id).map(quoteView)
        })),
      devFallback: true
    };
  });

  /**
   * Provider inbox: RFQs addressed to any company owned by the caller's organization.
   * Authorization comes from company ownership, never from a client-supplied id.
   */
  app.get(
    "/api/v1/rfqs/incoming",
    {
      onRequest: [app.authenticate],
      preHandler: [requireCompanyPermission("rfqs.read"), requireProviderOrganization()]
    },
    async (request) => {
    const user = getAuthUser(request);

    if (prisma) {
      const companies = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true }
      });
      if (companies.length === 0) return { items: [], companies: [] };
      const companyIds = companies.map((c: any) => c.id);
      const companyIdSet = new Set<string>(companyIds);

      const items = await (prisma as any).rfqRecipient.findMany({
        where: {
          companyId: { in: companyIds },
          rfq: { status: { in: ["submitted", "accepted", "cancelled"] } }
        },
        include: {
          rfq: {
            include: {
              // A provider may see only its own bids on this RFQ.
              quotes: { where: { companyId: { in: companyIds } }, include: { items: true } },
              documents: true
            }
          },
          company: { select: { id: true, name: true } }
        },
        orderBy: { invitedAt: "desc" },
        take: 100
      });
      return {
        items: items.map((item: any) => ({
          ...item,
          rfq: rfqViewForProvider(item.rfq, companyIdSet)
        })),
        companies
      };
    }

    const mine = devCompanies.filter((c) => c.organizationId === user.organizationId);
    const mineIds = mine.map((c) => c.id);
    const mineIdSet = new Set<string>(mineIds);
    const items = devRfqs
      .filter((r) => r.status !== "draft")
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
          rfq: rfqViewForProvider(
            { ...r, quotes: devQuotesList.filter((q) => q.rfqId === r.id) },
            mineIdSet
          ),
          devFallback: true
        };
      });
    return {
      items,
      companies: mine.map((c) => ({ id: c.id, name: c.name })),
      devFallback: true
    };
  });

  /**
   * Limited marketplace discovery. The customer deliberately selected
   * `discoveryMode=marketplace`; only then may an eligible registered provider
   * see this reduced view. Customer identity, documents and competing quotes are
   * never included, and joining is an explicit server-side step.
   */
  app.get(
    "/api/v1/rfqs/opportunities",
    {
      onRequest: [app.authenticate],
      preHandler: [requireCompanyPermission("rfqs.read"), requireProviderOrganization()]
    },
    async (request) => {
      const user = getAuthUser(request);
      const companies = await ownedCompanies(user.organizationId);
      const providerCompanies = companies.filter((company) => company.type !== "importer_exporter");
      if (providerCompanies.length === 0) {
        return { items: [], companies: [], disclaimer: "No provider company is registered for this organization." };
      }
      const companyIds = providerCompanies.map((company) => company.id);

      if (prisma) {
        const rfqs = await prisma.rfq.findMany({
          where: {
            discoveryMode: "marketplace",
            status: "submitted",
            organizationId: { not: user.organizationId }
          },
          include: {
            recipients: { where: { companyId: { in: companyIds } }, select: { companyId: true } },
            _count: { select: { documents: { where: { visibility: "providers" } } } }
          },
          orderBy: { createdAt: "desc" },
          take: 50
        });
        const items = rfqs
          .map((rfq) => {
            const eligibleCompanyIds = providerCompanies
              .filter((company) => companyCanServeMode(company, rfq.mode))
              .map((company) => company.id);
            if (eligibleCompanyIds.length === 0) return null;
            const joinedCompanyIds = rfq.recipients.map((recipient) => recipient.companyId);
            return {
              id: rfq.id,
              origin: rfq.origin,
              destination: rfq.destination,
              mode: rfq.mode,
              incoterm: rfq.incoterm,
              cargoDescription: rfq.cargoDescription,
              weightKg: asNumber(rfq.weightKg),
              volumeCbm: rfq.volumeCbm == null ? null : asNumber(rfq.volumeCbm),
              packageCount: rfq.packageCount,
              containerCount: rfq.containerCount,
              containerType: rfq.containerType,
              requiredService: rfq.requiredService,
              preferredPickupDate: rfq.preferredPickupDate,
              preferredDeliveryDate: rfq.preferredDeliveryDate,
              latestDeliveryDate: rfq.latestDeliveryDate,
              isHazardous: rfq.isHazardous,
              createdAt: rfq.createdAt,
              publicDocumentCount: rfq._count.documents,
              eligibleCompanyIds,
              joinedCompanyIds,
              joined: joinedCompanyIds.length > 0,
              canJoin: joinedCompanyIds.length === 0
            };
          })
          .filter(Boolean);
        return {
          items,
          companies: providerCompanies.map((company) => ({
            id: company.id,
            name: company.name,
            modes: company.services?.map((service) => service.mode) ?? []
          })),
          disclaimer:
            "Marketplace requests are shown in a limited form. No customer identity, contact details, documents or competing quotes are included. Only the customer's explicit marketplace choice makes discovery possible."
        };
      }

      const items = devRfqs
        .filter(
          (rfq) =>
            rfq.discoveryMode === "marketplace" &&
            rfq.status === "submitted" &&
            rfq.organizationId !== user.organizationId
        )
        .map((rfq) => {
          const eligibleCompanyIds = providerCompanies
            .filter((company) => companyCanServeMode(company, rfq.mode))
            .map((company) => company.id);
          if (eligibleCompanyIds.length === 0) return null;
          const joinedCompanyIds = rfq.recipients
            .filter((recipient: any) => companyIds.includes(recipient.companyId))
            .map((recipient: any) => recipient.companyId);
          return {
            id: rfq.id,
            origin: rfq.origin,
            destination: rfq.destination,
            mode: rfq.mode,
            cargoDescription: rfq.cargoDescription,
            weightKg: rfq.weightKg,
            volumeCbm: rfq.volumeCbm ?? null,
            requiredService: rfq.requiredService ?? null,
            createdAt: rfq.createdAt,
            eligibleCompanyIds,
            joinedCompanyIds,
            joined: joinedCompanyIds.length > 0,
            canJoin: joinedCompanyIds.length === 0
          };
        })
        .filter(Boolean);
      return {
        items,
        companies: providerCompanies.map((company) => ({ id: company.id, name: company.name })),
        devFallback: true
      };
    }
  );

  app.post(
    "/api/v1/rfqs/:id/join",
    {
      onRequest: [app.authenticate],
      preHandler: [requireCompanyPermission("quotes.submit"), requireProviderOrganization()]
    },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = z.object({ companyId: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      if (!(await ownsCompanyDb(user.organizationId, parsed.data.companyId))) return forbidden(reply);

      if (prisma) {
        const company = await prisma.company.findUnique({
          where: { id: parsed.data.companyId },
          select: { id: true, name: true, type: true, services: { select: { mode: true } } }
        });
        if (!company) return notFound(reply);
        const rfq = await prisma.rfq.findUnique({ where: { id } });
        if (!rfq) return notFound(reply);
        if (rfq.discoveryMode !== "marketplace" || rfq.status !== "submitted") {
          return reply.code(409).send({ error: "This request is not open to marketplace providers", code: "rfq_not_open" });
        }
        if (rfq.organizationId === user.organizationId) {
          return reply.code(400).send({ error: "You cannot join your own RFQ", code: "own_rfq" });
        }
        if (!companyCanServeMode(company, rfq.mode)) {
          return reply.code(403).send({ error: "This provider category/service does not match the RFQ mode", code: "provider_not_eligible" });
        }
        const existing = await prisma.rfqRecipient.findUnique({
          where: { rfqId_companyId: { rfqId: id, companyId: company.id } }
        });
        if (existing) {
          return { joined: true, alreadyJoined: true, rfqId: id, companyId: company.id };
        }
        await prisma.rfqRecipient.create({ data: { rfqId: id, companyId: company.id } });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "rfq.marketplace_join",
          entityType: "Rfq",
          entityId: id,
          requestId: request.id,
          metadata: { companyId: company.id }
        });
        await notify({
          organizationId: rfq.organizationId,
          type: "MARKETPLACE_JOINED",
          title: "انضم مزود إلى طلبك",
          body: `انضم مزود مؤهل إلى طلب ${rfq.origin} → ${rfq.destination} ويمكنه الآن تقديم عرض.`,
          dedupeKey: `rfq-join:${id}:${company.id}`,
          entityType: "Rfq",
          entityId: id,
          recipientUserIds: [rfq.createdByUserId]
        });
        return { joined: true, rfqId: id, companyId: company.id };
      }

      const rfq = devRfqs.find((candidate) => candidate.id === id);
      if (!rfq) return notFound(reply);
      if (rfq.discoveryMode !== "marketplace" || rfq.status !== "submitted") {
        return reply.code(409).send({ error: "This request is not open to marketplace providers", code: "rfq_not_open" });
      }
      if (rfq.organizationId === user.organizationId) {
        return reply.code(400).send({ error: "You cannot join your own RFQ", code: "own_rfq" });
      }
      const company = devCompanies.find((candidate) => candidate.id === parsed.data.companyId);
      if (!company || !companyCanServeMode(company, rfq.mode)) {
        return reply.code(403).send({ error: "This provider category/service does not match the RFQ mode", code: "provider_not_eligible" });
      }
      if (rfq.recipients.some((recipient: any) => recipient.companyId === company.id)) {
        return { joined: true, alreadyJoined: true, rfqId: id, companyId: company.id, devFallback: true };
      }
      rfq.recipients.push({ id: `dev-recipient-${Date.now()}`, companyId: company.id, status: "joined" });
      return { joined: true, rfqId: id, companyId: company.id, devFallback: true };
    }
  );

  app.post(
    "/api/v1/rfqs/:id/submit",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.create") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const rfq = await prisma.rfq.findUnique({ where: { id }, include: { recipients: true } });
        if (!rfq || rfq.organizationId !== user.organizationId) return notFound(reply);
        if (rfq.status === "submitted") return { ...rfq, alreadySubmitted: true };
        if (rfq.status !== "draft") {
          return reply.code(409).send({ error: "Only a draft RFQ can be submitted", code: "rfq_not_draft" });
        }
        const updated = await prisma.rfq.update({ where: { id }, data: { status: "submitted" } });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "rfq.submit",
          entityType: "Rfq",
          entityId: id,
          requestId: request.id
        });
        await notifyInvitedCompanies(
          rfq.recipients.map((recipient) => recipient.companyId),
          {
            type: "RFQ_SUBMITTED",
            title: "طلب عرض جديد",
            body: `وصلك طلب عرض جديد بمسار ${rfq.origin} → ${rfq.destination}.`,
            dedupeKey: `rfq-submitted:${rfq.id}`,
            rfqId: rfq.id
          }
        );
        return updated;
      }
      const rfq = devRfqs.find((candidate) => candidate.id === id && candidate.organizationId === user.organizationId);
      if (!rfq) return notFound(reply);
      if (rfq.status === "draft") {
        rfq.status = "submitted";
        rfq.updatedAt = new Date().toISOString();
      }
      return { ...rfq, devFallback: true };
    }
  );

  app.post(
    "/api/v1/rfqs/:id/cancel",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.create") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = z.object({ reason: z.string().trim().min(3).max(2000) }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      if (prisma) {
        try {
          const result = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
            const rfq = await tx.rfq.findUnique({ where: { id }, include: { recipients: true } });
            if (!rfq || rfq.organizationId !== user.organizationId) {
              throw Object.assign(new Error("rfq_not_found"), { code: "rfq_not_found" });
            }
            if (rfq.status === "cancelled") {
              throw Object.assign(new Error("already_cancelled"), { code: "rfq_already_cancelled" });
            }
            if (rfq.status === "accepted") {
              throw Object.assign(new Error("already_accepted"), { code: "rfq_already_accepted" });
            }
            const now = new Date();
            const updated = await tx.rfq.update({
              where: { id },
              data: {
                status: "cancelled",
                cancelledAt: now,
                cancelledByUserId: user.id,
                cancellationReason: parsed.data.reason
              }
            });
            await tx.quote.updateMany({
              where: { rfqId: id, status: "submitted" },
              data: {
                status: "rejected",
                decidedAt: now,
                decidedByUserId: user.id,
                rejectionReason: `RFQ cancelled: ${parsed.data.reason}`
              }
            });
            return { rfq: updated, recipientIds: rfq.recipients.map((recipient) => recipient.companyId) };
          });
          await recordAudit({
            organizationId: user.organizationId,
            actorUserId: user.id,
            action: "rfq.cancel",
            entityType: "Rfq",
            entityId: id,
            requestId: request.id,
            metadata: { reason: parsed.data.reason }
          });
          await notifyInvitedCompanies(result.recipientIds, {
            type: "RFQ_CANCELLED",
            title: "تم إلغاء طلب عرض",
            body: "قام العميل بإلغاء طلب عرض كان موجهاً إليك.",
            dedupeKey: `rfq-cancelled:${id}`,
            rfqId: id
          });
          return result.rfq;
        } catch (error: any) {
          if (error?.code === "rfq_not_found") return notFound(reply);
          if (error?.code === "rfq_already_cancelled") {
            return reply.code(409).send({ error: "RFQ is already cancelled", code: error.code });
          }
          if (error?.code === "rfq_already_accepted") {
            return reply.code(409).send({ error: "An accepted RFQ cannot be cancelled", code: error.code });
          }
          throw error;
        }
      }

      const rfq = devRfqs.find((candidate) => candidate.id === id && candidate.organizationId === user.organizationId);
      if (!rfq) return notFound(reply);
      if (rfq.status === "accepted") {
        return reply.code(409).send({ error: "An accepted RFQ cannot be cancelled", code: "rfq_already_accepted" });
      }
      if (rfq.status !== "cancelled") {
        rfq.status = "cancelled";
        rfq.cancelledAt = new Date().toISOString();
        rfq.cancelledByUserId = user.id;
        rfq.cancellationReason = parsed.data.reason;
        rfq.updatedAt = new Date().toISOString();
      }
      return { ...rfq, devFallback: true };
    }
  );

  /**
   * Authorized lifecycle history. Providers receive only their own quote and
   * booking events plus shipment milestones; they never see competing quotes or
   * customer user identities.
   */
  app.get(
    "/api/v1/rfqs/:id/activity",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const rfq = await prisma.rfq.findUnique({
          where: { id },
          include: {
            quotes: true,
            bookings: true,
            shipment: { include: { events: { orderBy: { occurredAt: "asc" } } } },
            recipients: true
          }
        });
        if (!rfq) return notFound(reply);
        const myCompanies = await prisma.company.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true }
        });
        const myCompanyIds = new Set(myCompanies.map((company) => company.id));
        const isOwner = rfq.organizationId === user.organizationId;
        const isInvited = rfq.recipients.some((recipient) => myCompanyIds.has(recipient.companyId));
        if (!isOwner && !isInvited) return forbidden(reply);

        const ownQuoteIds = new Set(
          rfq.quotes
            .filter((quote) => myCompanyIds.has(quote.companyId))
            .map((quote) => quote.id)
        );
        const visibleQuotes = isOwner
          ? rfq.quotes
          : rfq.quotes.filter((quote) => myCompanyIds.has(quote.companyId));
        const visibleBookings = isOwner
          ? rfq.bookings
          : rfq.bookings.filter(
              (booking) => booking.quoteId && ownQuoteIds.has(booking.quoteId)
            );

        const actorIds = [
          rfq.createdByUserId,
          ...visibleQuotes.flatMap((quote) => [quote.submittedByUserId, quote.decidedByUserId]),
          ...visibleBookings.flatMap((booking) => [booking.createdByUserId, booking.decidedByUserId]),
          ...(rfq.shipment?.events ?? []).map((event) => event.actorUserId)
        ].filter((value): value is string => Boolean(value));
        const actors = isOwner
          ? await prisma.user.findMany({
              where: { id: { in: [...new Set(actorIds)] } },
              select: { id: true, displayName: true }
            })
          : [];
        const actorNames = new Map(actors.map((actor) => [actor.id, actor.displayName]));
        const actorFor = (userId: string | null | undefined, fallback: "customer" | "provider" | "system") => {
          if (!isOwner) return { role: fallback };
          return {
            role: fallback,
            id: userId ?? null,
            displayName: userId ? actorNames.get(userId) ?? null : null
          };
        };

        const events: any[] = [
          {
            id: `rfq-created:${rfq.id}`,
            type: "RFQ_CREATED",
            at: rfq.createdAt,
            status: rfq.status === "draft" ? "draft" : "submitted",
            actor: actorFor(rfq.createdByUserId, "customer"),
            summary: rfq.status === "draft" ? "تم حفظ الطلب كمسودة" : "تم إنشاء طلب العرض"
          }
        ];
        if (rfq.cancelledAt) {
          events.push({
            id: `rfq-cancelled:${rfq.id}`,
            type: "RFQ_CANCELLED",
            at: rfq.cancelledAt,
            status: "cancelled",
            actor: actorFor(rfq.cancelledByUserId, "customer"),
            reason: rfq.cancellationReason,
            summary: "تم إلغاء طلب العرض"
          });
        }
        for (const quote of visibleQuotes) {
          events.push({
            id: `quote-submitted:${quote.id}`,
            type: "QUOTE_SUBMITTED",
            at: quote.createdAt,
            status: "submitted",
            actor: actorFor(quote.submittedByUserId, "provider"),
            reason: null,
            summary: `عرض سعر (نسخة ${quote.revisionNumber}) بقيمة ${quote.currency} ${asNumber(quote.totalAmount)}`
          });
          if (quote.withdrawnAt) {
            events.push({
              id: `quote-withdrawn:${quote.id}`,
              type: "QUOTE_WITHDRAWN",
              at: quote.withdrawnAt,
              status: "withdrawn",
              actor: actorFor(quote.decidedByUserId, "provider"),
              summary: "تم سحب العرض"
            });
          }
          if (quote.decidedAt && !quote.withdrawnAt) {
            events.push({
              id: `quote-decided:${quote.id}`,
              type: quote.status === "accepted" ? "QUOTE_ACCEPTED" : "QUOTE_REJECTED",
              at: quote.decidedAt,
              status: quote.status,
              actor: actorFor(quote.decidedByUserId, "customer"),
              reason: quote.rejectionReason,
              summary: quote.status === "accepted" ? "تم قبول العرض" : "تم رفض العرض"
            });
          }
        }
        for (const booking of visibleBookings) {
          events.push({
            id: `booking-created:${booking.id}`,
            type: "BOOKING_REQUESTED",
            at: booking.createdAt,
            status: booking.status,
            actor: actorFor(booking.createdByUserId, "customer"),
            summary: "تم إنشاء حجز"
          });
          if (booking.confirmedAt) {
            events.push({
              id: `booking-confirmed:${booking.id}`,
              type: "BOOKING_CONFIRMED",
              at: booking.confirmedAt,
              status: "confirmed",
              actor: actorFor(booking.decidedByUserId, "provider"),
              summary: "أكد المزود الحجز"
            });
          }
          if (booking.decidedAt && booking.status === "rejected") {
            events.push({
              id: `booking-rejected:${booking.id}`,
              type: "BOOKING_REJECTED",
              at: booking.decidedAt,
              status: "rejected",
              actor: actorFor(booking.decidedByUserId, "provider"),
              reason: booking.rejectionReason,
              summary: "رفض المزود الحجز"
            });
          }
          if (booking.cancelledAt) {
            events.push({
              id: `booking-cancelled:${booking.id}`,
              type: "BOOKING_CANCELLED",
              at: booking.cancelledAt,
              status: "cancelled",
              actor: actorFor(booking.decidedByUserId, "customer"),
              reason: booking.cancellationReason,
              summary: "تم إلغاء الحجز"
            });
          }
        }
        for (const event of rfq.shipment?.events ?? []) {
          events.push({
            id: `shipment-event:${event.id}`,
            type: "SHIPMENT_UPDATE",
            at: event.occurredAt,
            status: event.code,
            actor: actorFor(event.actorUserId, event.source === "imported" ? "system" : "provider"),
            reason: event.note,
            summary: event.label
          });
        }
        return {
          rfqId: id,
          viewerRole: isOwner ? "owner" : "provider",
          items: events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
          disclaimer:
            "Lifecycle history is built from persisted RFQ, quote, booking and shipment records. Booking status is not proof of a confirmed external carrier booking."
        };
      }

      const rfq = devRfqs.find((candidate) => candidate.id === id);
      if (!rfq) return notFound(reply);
      const mine = new Set(
        devCompanies
          .filter((company) => company.organizationId === user.organizationId)
          .map((company) => company.id)
      );
      const isOwner = rfq.organizationId === user.organizationId;
      if (!isOwner && !rfq.recipients.some((recipient: any) => mine.has(recipient.companyId))) {
        return forbidden(reply);
      }
      return {
        rfqId: id,
        viewerRole: isOwner ? "owner" : "provider",
        items: [
          {
            id: `rfq-created:${rfq.id}`,
            type: "RFQ_CREATED",
            at: rfq.createdAt,
            status: rfq.status,
            summary: "تم إنشاء طلب العرض"
          }
        ],
        devFallback: true
      };
    }
  );

  app.get("/api/v1/rfqs/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope === "app" && !hasCompanyPermission(user, "rfqs.read")) {
      return reply.code(403).send({ error: "Insufficient company permission", code: "insufficient_company_permission" });
    }
    const { id } = request.params as { id: string };
    if (prisma) {
      const rfq = await (prisma as any).rfq.findUnique({
        where: { id },
        include: {
          recipients: true,
          quotes: {
            include: {
              items: true,
              company: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  verificationStatus: true
                }
              }
            }
          },
          documents: { orderBy: { uploadedAt: "desc" } },
          bookings: {
            select: {
              id: true,
              status: true,
              shipmentId: true,
              externalReference: true,
              createdAt: true
            },
            orderBy: { createdAt: "desc" }
          }
        }
      });
      if (!rfq) return notFound(reply);
      const myCompanies = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true }
      });
      const myCompanyIds = new Set<string>(myCompanies.map((company: any) => company.id));
      const isOwner = rfq.organizationId === user.organizationId;
      const isInvited = rfq.recipients.some((recipient: any) =>
        myCompanyIds.has(recipient.companyId)
      );
      const platformView = can(user, "rfqs.read");
      if (!isOwner && !isInvited && !platformView) return forbidden(reply);
      if (!isOwner && !platformView && rfq.status === "draft") return forbidden(reply);
      if (isOwner || platformView) {
        const canSeePrivateDocuments = isOwner || platformView;
        return {
          ...rfq,
          documents: rfq.documents
            .filter((document: any) => canSeePrivateDocuments || document.visibility === "providers")
            .map(documentView),
          quotes: rfq.quotes.map(quoteView),
          viewerRole: isOwner ? "owner" : "staff"
        };
      }
      return { ...rfqViewForProvider(rfq, myCompanyIds), viewerRole: "provider" };
    }
    const rfq = devRfqs.find((r) => r.id === id);
    if (!rfq) return notFound(reply);
    const mine = devCompanies
      .filter((company) => company.organizationId === user.organizationId)
      .map((company) => company.id);
    const mineIdSet = new Set<string>(mine);
    const isOwner = rfq.organizationId === user.organizationId;
    const isInvited = rfq.recipients.some((recipient: any) => mineIdSet.has(recipient.companyId));
    const platformView = can(user, "rfqs.read");
    if (!isOwner && !isInvited && !platformView) return forbidden(reply);
    if (!isOwner && !platformView && rfq.status === "draft") return forbidden(reply);
    const withQuotes = {
      ...rfq,
      documents: [],
      quotes: devQuotesList.filter((quote) => quote.rfqId === id)
    };
    return isOwner || platformView
      ? { ...withQuotes, quotes: withQuotes.quotes.map(quoteView), viewerRole: isOwner ? "owner" : "staff", devFallback: true }
      : { ...rfqViewForProvider(withQuotes, mineIdSet), viewerRole: "provider", devFallback: true };
  });

  const rfqDocumentUploadSchema = z.object({
    type: z.string().trim().min(1).max(100),
    filename: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(150),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
    dataBase64: z.string().min(1),
    visibility: z.enum(["providers", "private"]).optional()
  });

  app.get(
    "/api/v1/rfqs/:id/documents",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (!prisma) return { items: [], devFallback: true };
      const rfq = await prisma.rfq.findUnique({
        where: { id },
        include: {
          recipients: true,
          documents: { orderBy: { uploadedAt: "desc" } }
        }
      });
      if (!rfq) return notFound(reply);
      const myCompanies = await prisma.company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true }
      });
      const mine = new Set(myCompanies.map((company) => company.id));
      const isOwner = rfq.organizationId === user.organizationId;
      const isInvited = rfq.recipients.some((recipient) => mine.has(recipient.companyId));
      if (!isOwner && !isInvited) return forbidden(reply);
      return {
        items: rfq.documents
          .filter((document) => isOwner || document.visibility === "providers")
          .map(documentView),
        viewerRole: isOwner ? "owner" : "provider"
      };
    }
  );

  app.post(
    "/api/v1/rfqs/:id/documents",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.create") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = rfqDocumentUploadSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      if (!prisma) {
        return reply.code(503).send({
          error: "RFQ documents require the PostgreSQL persistence layer",
          code: "database_required"
        });
      }
      const rfq = await prisma.rfq.findUnique({ where: { id }, select: { id: true, organizationId: true, status: true } });
      if (!rfq || rfq.organizationId !== user.organizationId) return notFound(reply);
      if (rfq.status === "cancelled") {
        return reply.code(409).send({ error: "Documents cannot be added to a cancelled RFQ", code: "rfq_cancelled" });
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(parsed.data.dataBase64, "base64");
      } catch {
        return reply.code(400).send({ error: "Invalid file encoding", code: "invalid_file" });
      }
      if (buffer.length === 0 || buffer.length !== parsed.data.size) {
        return reply.code(400).send({ error: "Declared file size does not match the content", code: "invalid_file_size" });
      }
      try {
        const filename = sanitizeDisplayFilename(parsed.data.filename);
        const validated = validateFileContent({
          buffer,
          filename,
          declaredContentType: parsed.data.contentType
        });
        const scan = await scanUpload(buffer);
        const storageKey = createStorageKey(["rfq", id], extensionForFilename(filename));
        await storageAdapter.put(storageKey, buffer, validated.contentType);
        const document = await prisma.rfqDocument.create({
          data: {
            rfqId: id,
            organizationId: user.organizationId,
            type: parsed.data.type,
            filename,
            storageKey,
            contentType: validated.contentType,
            size: validated.size,
            contentHash: contentHash(buffer),
            malwareScanStatus: scan.status,
            malwareScanDetail: scan as any,
            visibility: parsed.data.visibility ?? "providers",
            uploadedByUserId: user.id,
            status: "uploaded"
          }
        });
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "rfq.document_upload",
          entityType: "RfqDocument",
          entityId: document.id,
          requestId: request.id,
          metadata: {
            rfqId: id,
            visibility: document.visibility,
            contentType: document.contentType,
            size: document.size,
            malwareScanStatus: document.malwareScanStatus
          }
        });
        return reply.code(201).send(documentView(document));
      } catch (error: any) {
        if (error instanceof FileValidationError) {
          return reply.code(error.statusCode).send({ error: error.message, code: error.code });
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/v1/rfqs/:id/documents/:documentId",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id, documentId } = request.params as { id: string; documentId: string };
      if (!prisma) return notFound(reply);
      const document = await prisma.rfqDocument.findUnique({
        where: { id: documentId },
        include: {
          rfq: { include: { recipients: true } }
        }
      });
      if (!document || document.rfqId !== id || document.status === "deleted") return notFound(reply);
      const myCompanies = await prisma.company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true }
      });
      const mine = new Set(myCompanies.map((company) => company.id));
      const isOwner = document.organizationId === user.organizationId;
      const isInvited = document.rfq.recipients.some((recipient) => mine.has(recipient.companyId));
      if (!isOwner && !isInvited) return notFound(reply);
      if (!isOwner && document.visibility !== "providers") return notFound(reply);
      if (!isOwner && document.rfq.status === "draft") return notFound(reply);
      let buffer: Buffer;
      try {
        buffer = await storageAdapter.read(document.storageKey);
      } catch {
        return notFound(reply);
      }
      reply
        .header("Content-Type", document.contentType ?? "application/octet-stream")
        .header("Content-Length", String(buffer.length))
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`
        );
      return reply.send(buffer);
    }
  );

  const quoteSchema = z
    .object({
      companyId: z.string().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO code"),
      transitDays: z.number().int().positive().max(3650),
      validityUntil: z.string().min(1),
      pricingSource: z.enum(QUOTE_PRICING_SOURCES).optional(),
      priceConfidence: z.enum(QUOTE_PRICE_CONFIDENCE).optional(),
      notes: z.string().trim().max(4000).optional(),
      terms: z.string().trim().max(8000).optional(),
      serviceDetails: z.string().trim().max(4000).optional(),
      routeDetails: z.string().trim().max(4000).optional(),
      unknownCharges: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
      excludedServices: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
      items: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(200),
            amount: z.number().finite().nonnegative().max(1_000_000_000_000),
            currency: z.string().regex(/^[A-Z]{3}$/),
            included: z.boolean().optional(),
            optional: z.boolean().optional(),
            chargeType: z.enum(QUOTE_CHARGE_TYPES).optional(),
            pricingSource: z.enum(QUOTE_PRICING_SOURCES).optional(),
            priceConfidence: z.enum(QUOTE_PRICE_CONFIDENCE).optional(),
            sourceReference: z.string().trim().max(500).optional(),
            notes: z.string().trim().max(1000).optional()
          })
        )
        .min(1)
        .max(100)
    })
    .superRefine((input, ctx) => {
      const chargeable = input.items.filter(
        (item) => item.included !== false && item.optional !== true && item.amount > 0
      );
      if (chargeable.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one included, non-optional charge must be positive",
          path: ["items"]
        });
      }
      const quoteSource = input.pricingSource ?? "provider_submitted";
      const quoteConfidence = input.priceConfidence ?? "indicative";
      if (["estimated", "calculated"].includes(quoteSource) && quoteConfidence === "confirmed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "An estimated or calculated price cannot be marked confirmed",
          path: ["priceConfidence"]
        });
      }
      if (
        quoteSource === "published_tariff" &&
        !input.items.some((item) => Boolean(item.sourceReference)) &&
        !input.notes
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A published-tariff quote must reference the published source",
          path: ["pricingSource"]
        });
      }
    });

  app.post(
    "/api/v1/rfqs/:id/quotes",
    {
      onRequest: [app.authenticate],
      preHandler: [requireCompanyPermission("quotes.submit"), requireProviderOrganization()]
    },
    async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = quoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;
    if (!(await ownsCompanyDb(user.organizationId, input.companyId))) return forbidden(reply);

    const validityUntil = new Date(input.validityUntil);
    if (Number.isNaN(validityUntil.getTime()) || validityUntil.getTime() <= Date.now()) {
      return reply.code(400).send({
        error: "Quote validity must be a valid future date",
        code: "invalid_validity"
      });
    }
    if (input.items.some((item) => item.currency !== input.currency)) {
      return reply.code(400).send({
        error: "Every line item must use the quote currency",
        code: "currency_mismatch"
      });
    }
    // The customer-visible total counts only included, non-optional components.
    // Excluded/optional amounts are preserved separately and never silently added.
    const totalAmount = input.items
      .filter((item) => item.included !== false && item.optional !== true)
      .reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return reply.code(400).send({
        error: "A quote must have a positive included total",
        code: "invalid_total"
      });
    }

    // A company may quote only on an RFQ it was explicitly invited to. Knowing
    // the RFQ id is not permission to bid on it.
    const invited = prisma
      ? Boolean(
          await prisma.rfqRecipient.findUnique({
            where: { rfqId_companyId: { rfqId: id, companyId: input.companyId } }
          })
        )
      : Boolean(
          devRfqs
            .find((rfq) => rfq.id === id)
            ?.recipients.some((recipient: any) => recipient.companyId === input.companyId)
        );
    if (!invited) return forbidden(reply);

    if (prisma) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
          const rfq = await tx.rfq.findUnique({ where: { id } });
          if (!rfq) throw Object.assign(new Error("rfq_not_found"), { code: "rfq_not_found" });
          if (rfq.status !== "submitted") {
            throw Object.assign(new Error("rfq_not_open"), { code: "rfq_not_open", status: rfq.status });
          }
          const stillInvited = await tx.rfqRecipient.findUnique({
            where: { rfqId_companyId: { rfqId: id, companyId: input.companyId } }
          });
          if (!stillInvited) {
            throw Object.assign(new Error("provider_not_invited"), { code: "provider_not_invited" });
          }

          const now = new Date();
          const activeQuote = await tx.quote.findFirst({
            where: { rfqId: id, companyId: input.companyId, status: "submitted" },
            orderBy: { createdAt: "desc" }
          });
          if (activeQuote && activeQuote.validityUntil > now) {
            throw Object.assign(new Error("quote_already_submitted"), { code: "quote_already_submitted" });
          }
          if (activeQuote) {
            await tx.quote.update({
              where: { id: activeQuote.id },
              data: { status: "expired", decidedAt: now }
            });
          }
          const previousQuote = await tx.quote.findFirst({
            where: { rfqId: id, companyId: input.companyId },
            orderBy: { createdAt: "desc" }
          });

          const quote = await tx.quote.create({
            data: {
              rfqId: id,
              companyId: input.companyId,
              organizationId: rfq.organizationId,
              currency: input.currency,
              totalAmount,
              transitDays: input.transitDays,
              validityUntil,
              status: "submitted",
              notes: input.notes,
              terms: input.terms,
              serviceDetails: input.serviceDetails,
              routeDetails: input.routeDetails,
              pricingSource: input.pricingSource ?? "provider_submitted",
              priceConfidence: input.priceConfidence ?? "indicative",
              unknownCharges: input.unknownCharges ?? [],
              excludedServices: input.excludedServices ?? [],
              revisionNumber: (previousQuote?.revisionNumber ?? 0) + 1,
              supersedesQuoteId: previousQuote?.id,
              submittedByUserId: user.id,
              items: {
                create: input.items.map((item) => ({
                  label: item.label,
                  amount: item.amount,
                  currency: item.currency,
                  included: item.included ?? true,
                  optional: item.optional ?? false,
                  chargeType: item.chargeType ?? "other",
                  pricingSource: item.pricingSource ?? input.pricingSource ?? "provider_submitted",
                  priceConfidence: item.priceConfidence ?? input.priceConfidence ?? "indicative",
                  sourceReference: item.sourceReference,
                  notes: item.notes
                }))
              }
            },
            include: { items: true }
          });
          return {
            quote,
            organizationId: rfq.organizationId,
            origin: rfq.origin,
            destination: rfq.destination,
            createdByUserId: rfq.createdByUserId
          };
        });
        await recordAudit({
          organizationId: result.organizationId,
          actorUserId: user.id,
          action: "quote.submit",
          entityType: "Quote",
          entityId: result.quote.id,
          metadata: { rfqId: id, companyId: input.companyId }
        });
        await notify({
          organizationId: result.organizationId,
          type: "QUOTATION_RECEIVED",
          title:
            result.quote.revisionNumber > 1 ? "تم استلام نسخة محدثة من عرض سعر" : "تم استلام عرض سعر",
          body: `تم استلام ${
            result.quote.revisionNumber > 1 ? "نسخة محدثة من " : ""
          }عرض سعر على طلب ${result.origin} → ${result.destination}.`,
          dedupeKey: `quote-submitted:${result.quote.id}`,
          entityType: "Rfq",
          entityId: id,
          recipientUserIds: [result.createdByUserId]
        });
        return quoteView(result.quote);
      } catch (error: any) {
        if (error?.code === "P2002" || error?.code === "quote_already_submitted") {
          return reply.code(409).send({
            error: "This company has already submitted a quote for this RFQ",
            code: "quote_already_submitted"
          });
        }
        if (error?.code === "rfq_not_found") return notFound(reply);
        if (error?.code === "rfq_not_open") {
          return reply.code(409).send({
            error: "This RFQ is no longer accepting quotes",
            code: error.code,
            status: error.status
          });
        }
        if (error?.code === "provider_not_invited") return forbidden(reply);
        throw error;
      }
    }

    const rfq = devRfqs.find((r) => r.id === id);
    if (!rfq) return notFound(reply);
    if (rfq.status !== "submitted") {
      return reply.code(409).send({ error: "This RFQ is no longer accepting quotes", code: "rfq_not_open" });
    }
    const activeQuote = devQuotesList.find(
      (quote) =>
        quote.rfqId === id &&
        quote.companyId === input.companyId &&
        quote.status === "submitted" &&
        new Date(quote.validityUntil).getTime() > Date.now()
    );
    if (activeQuote) {
      return reply.code(409).send({
        error: "This company has already submitted an active quote for this RFQ",
        code: "quote_already_submitted"
      });
    }
    const previousQuote = [...devQuotesList]
      .reverse()
      .find((quote) => quote.rfqId === id && quote.companyId === input.companyId);
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
      notes: input.notes,
      terms: input.terms,
      serviceDetails: input.serviceDetails,
      routeDetails: input.routeDetails,
      pricingSource: input.pricingSource ?? "provider_submitted",
      priceConfidence: input.priceConfidence ?? "indicative",
      unknownCharges: input.unknownCharges ?? [],
      excludedServices: input.excludedServices ?? [],
      revisionNumber: (previousQuote?.revisionNumber ?? 0) + 1,
      supersedesQuoteId: previousQuote?.id,
      submittedByUserId: user.id,
      createdAt: new Date().toISOString(),
      items: input.items.map((i, idx) => ({
        id: `dev-qi-${idx + 1}`,
        ...i,
        included: i.included ?? true,
        optional: i.optional ?? false,
        chargeType: i.chargeType ?? "other",
        pricingSource: i.pricingSource ?? input.pricingSource ?? "provider_submitted",
        priceConfidence: i.priceConfidence ?? input.priceConfidence ?? "indicative"
      }))
    };
    devQuotesList.push(quote);
    return { ...quoteView(quote), devFallback: true };
    }
  );

  app.get(
    "/api/v1/rfqs/:id/quotes/compare",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("rfqs.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      if (prisma) {
        const rfq = await prisma.rfq.findUnique({
          where: { id },
          include: {
            quotes: {
              include: {
                items: true,
                company: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                    verificationStatus: true,
                    country: true
                  }
                }
              },
              orderBy: { createdAt: "asc" }
            }
          }
        });
        if (!rfq) return notFound(reply);
        const authorized = rfq.organizationId === user.organizationId || can(user, "rfqs.read");
        if (!authorized) return forbidden(reply);
        const now = Date.now();
        const groups = new Map<string, any[]>();
        for (const quote of rfq.quotes) {
          const view = quoteView(quote);
          const expired =
            quote.status === "expired" ||
            (quote.status === "submitted" && new Date(quote.validityUntil).getTime() <= now);
          const entry = {
            ...view,
            status: expired ? "expired" : quote.status,
            isExpired: expired,
            canAccept:
              rfq.status === "submitted" && quote.status === "submitted" && !expired,
            company: quote.company,
            itemBreakdown: view.items,
            serviceDifferences: {
              transitDays: quote.transitDays,
              serviceDetails: quote.serviceDetails ?? null,
              routeDetails: quote.routeDetails ?? null,
              excludedServices: quote.excludedServices ?? [],
              unknownCharges: quote.unknownCharges ?? []
            }
          };
          const currency = quote.currency;
          groups.set(currency, [...(groups.get(currency) ?? []), entry]);
        }
        return {
          rfqId: rfq.id,
          rfqStatus: rfq.status,
          groups: [...groups.entries()].map(([currency, quotes]) => ({
            currency,
            quotes,
            // Lowest is informational only; service and provenance differ.
            lowestIncludedTotal: Math.min(...quotes.map((quote) => quote.totalAmount))
          })),
          crossCurrencyComparison: false,
          disclaimer:
            "Quotes are grouped by currency and are never converted or combined. The lowest headline total is not a recommendation. Compare included, excluded, optional and estimated charges, transit time, service scope and pricing provenance."
        };
      }

      const rfq = devRfqs.find((candidate) => candidate.id === id);
      if (!rfq || (rfq.organizationId !== user.organizationId && !can(user, "rfqs.read"))) {
        return notFound(reply);
      }
      const groups = new Map<string, any[]>();
      for (const quote of devQuotesList.filter((candidate) => candidate.rfqId === id)) {
        const entry = quoteView(quote);
        const currency = quote.currency;
        groups.set(currency, [...(groups.get(currency) ?? []), entry]);
      }
      return {
        rfqId: id,
        rfqStatus: rfq.status,
        groups: [...groups.entries()].map(([currency, quotes]) => ({ currency, quotes })),
        crossCurrencyComparison: false,
        devFallback: true,
        disclaimer:
          "Quotes are grouped by currency and are never converted or combined. The lowest headline total is not a recommendation."
      };
    }
  );

  app.post(
    "/api/v1/rfqs/:id/quotes/:quoteId/withdraw",
    {
      onRequest: [app.authenticate],
      preHandler: [requireCompanyPermission("quotes.submit"), requireProviderOrganization()]
    },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id, quoteId } = request.params as { id: string; quoteId: string };

      if (!prisma) {
        const quote = devQuotesList.find((candidate) => candidate.id === quoteId && candidate.rfqId === id);
        if (!quote) return reply.code(404).send({ error: "Quote not found", code: "quote_not_found" });
        if (!(await ownsCompanyDb(user.organizationId, quote.companyId))) return forbidden(reply);
        if (quote.status === "accepted") {
          return reply.code(409).send({
            error: "An accepted quote cannot be withdrawn",
            code: "quote_already_accepted"
          });
        }
        if (quote.status === "withdrawn") return { ...quote, alreadyWithdrawn: true, devFallback: true };
        if (quote.status !== "submitted") {
          return reply.code(409).send({ error: "Quote cannot be withdrawn", code: "quote_not_withdrawable" });
        }
        quote.status = "withdrawn";
        return { ...quote, devFallback: true };
      }

      const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
      if (!existing || existing.rfqId !== id) {
        return reply.code(404).send({ error: "Quote not found", code: "quote_not_found" });
      }
      if (!(await ownsCompanyDb(user.organizationId, existing.companyId))) return forbidden(reply);

      try {
        const quote = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
          const current = await tx.quote.findUnique({ where: { id: quoteId } });
          if (!current) throw Object.assign(new Error("quote_not_found"), { code: "quote_not_found" });
          if (current.status === "accepted") {
            throw Object.assign(new Error("quote_already_accepted"), { code: "quote_already_accepted" });
          }
          if (current.status === "withdrawn") {
            throw Object.assign(new Error("quote_already_withdrawn"), { code: "quote_already_withdrawn" });
          }
          if (current.status !== "submitted") {
            throw Object.assign(new Error("quote_not_withdrawable"), { code: "quote_not_withdrawable" });
          }
          const now = new Date();
          return tx.quote.update({
            where: { id: quoteId },
            data: {
              status: "withdrawn",
              withdrawnAt: now,
              decidedAt: now,
              decidedByUserId: user.id,
              rejectionReason: "Withdrawn by provider."
            }
          });
        });
        await recordAudit({
          organizationId: existing.organizationId,
          actorUserId: user.id,
          action: "quote.withdrawn",
          entityType: "Quote",
          entityId: quoteId,
          outcome: "success",
          requestId: request.id,
          metadata: { rfqId: id, companyId: existing.companyId }
        });
        await notify({
          organizationId: existing.organizationId,
          type: "QUOTATION_WITHDRAWN",
          title: "تم سحب عرض سعر",
          body: "قام أحد المزودين بسحب عرضه قبل قبوله.",
          dedupeKey: `quote-withdrawn:${quoteId}`,
          entityType: "Quote",
          entityId: quoteId,
          severity: "warning"
        });
        return quote;
      } catch (error: any) {
        if (error?.code === "quote_not_found") {
          return reply.code(404).send({ error: "Quote not found", code: error.code });
        }
        if (error?.code === "quote_already_withdrawn") {
          const current = await prisma.quote.findUnique({ where: { id: quoteId } });
          return { ...current, alreadyWithdrawn: true };
        }
        if (error?.code === "quote_already_accepted") {
          return reply.code(409).send({
            error: "An accepted quote cannot be withdrawn",
            code: error.code
          });
        }
        if (error?.code === "quote_not_withdrawable") {
          return reply.code(409).send({
            error: "Only a submitted quote can be withdrawn",
            code: error.code
          });
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/v1/rfqs/:id/accept",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("quotes.accept") },
    async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ quoteId: z.string().min(1), shipmentId: z.string().min(1).optional() })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      if (parsed.data.shipmentId) {
        const shipment = await prisma.shipment.findFirst({
          where: { id: parsed.data.shipmentId, organizationId: user.organizationId }
        });
        if (!shipment) {
          return reply.code(404).send({ error: "Shipment not found", code: "shipment_not_found" });
        }
        if (shipment.status === "DELIVERED" || shipment.status === "CANCELLED") {
          return reply.code(409).send({
            error: "A closed shipment cannot receive a new booking",
            code: "shipment_not_bookable",
            status: shipment.status
          });
        }
      }

      let result: { booking: any; idempotent: boolean; providerCompanyId?: string } | null;
      try {
        result = await prisma.$transaction(async (tx) => {
          // Serialize acceptance for this RFQ. The partial unique index on
          // Quote(rfqId) WHERE status='accepted' is the second line of defence.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
          const rfq = await tx.rfq.findUnique({ where: { id }, include: { quotes: true } });
          if (!rfq || rfq.organizationId !== user.organizationId) return null;

          const accepted = rfq.quotes.find((quote) => quote.status === "accepted");
          if (accepted) {
            if (accepted.id === parsed.data.quoteId) {
              const existing = await tx.bookingRequest.findUnique({ where: { quoteId: accepted.id } });
              if (existing) {
                return {
                  booking: existing,
                  idempotent: true,
                  providerCompanyId: accepted.companyId
                };
              }
            }
            throw Object.assign(new Error("quotation_already_accepted"), {
              code: "quotation_already_accepted",
              acceptedQuoteId: accepted.id
            });
          }
          if (rfq.status !== "submitted") {
            throw Object.assign(new Error("rfq_not_open"), { code: "rfq_not_open" });
          }

          const quote = rfq.quotes.find((candidate) => candidate.id === parsed.data.quoteId);
          if (!quote) throw Object.assign(new Error("quote_not_found"), { code: "quote_not_found" });
          if (quote.status !== "submitted") {
            throw Object.assign(new Error("quote_not_acceptable"), {
              code: "quote_not_acceptable",
              status: quote.status
            });
          }
          if (quote.validityUntil.getTime() <= Date.now()) {
            throw Object.assign(new Error("quote_expired"), { code: "quote_expired" });
          }

          let shipmentId = rfq.shipmentId ?? undefined;
          if (parsed.data.shipmentId) {
            const suppliedShipment = await tx.shipment.findFirst({
              where: {
                id: parsed.data.shipmentId,
                organizationId: user.organizationId
              }
            });
            if (!suppliedShipment) {
              throw Object.assign(new Error("shipment_not_found"), { code: "shipment_not_found" });
            }
            if (shipmentId && shipmentId !== suppliedShipment.id) {
              throw Object.assign(new Error("rfq_shipment_conflict"), { code: "rfq_shipment_conflict" });
            }
            if (
              rfq.originPortId &&
              (suppliedShipment.originPortId !== rfq.originPortId ||
                suppliedShipment.destinationPortId !== rfq.destinationPortId ||
                suppliedShipment.mode !== rfq.mode ||
                suppliedShipment.incoterm !== rfq.incoterm)
            ) {
              throw Object.assign(new Error("shipment_route_mismatch"), { code: "shipment_route_mismatch" });
            }
            if (suppliedShipment.status === "DELIVERED" || suppliedShipment.status === "CANCELLED") {
              throw Object.assign(new Error("shipment_not_bookable"), {
                code: "shipment_not_bookable",
                status: suppliedShipment.status
              });
            }
            shipmentId = suppliedShipment.id;
          } else if (shipmentId) {
            const linkedShipment = await tx.shipment.findFirst({
              where: { id: shipmentId, organizationId: user.organizationId }
            });
            if (!linkedShipment) {
              throw Object.assign(new Error("shipment_not_found"), { code: "shipment_not_found" });
            }
            if (linkedShipment.status === "DELIVERED" || linkedShipment.status === "CANCELLED") {
              throw Object.assign(new Error("shipment_not_bookable"), {
                code: "shipment_not_bookable",
                status: linkedShipment.status
              });
            }
          } else if (rfq.originPortId && rfq.destinationPortId && rfq.incoterm) {
            const shipment = await tx.shipment.create({
              data: {
                reference: `SHP-${Date.now()}-${randomUUID().slice(0, 8)}`,
                organizationId: user.organizationId,
                createdByUserId: user.id,
                originPortId: rfq.originPortId,
                destinationPortId: rfq.destinationPortId,
                mode: rfq.mode,
                incoterm: rfq.incoterm,
                status: "QUOTED",
                cargoDescription: rfq.cargoDescription,
                weightKg: rfq.weightKg,
                parties: {
                  create: {
                    companyId: quote.companyId,
                    partyRole: "FREIGHT_FORWARDER",
                    canView: true,
                    canUpdateStatus: true,
                    canUploadDocuments: true,
                    canViewDocuments: true
                  }
                }
              }
            });
            shipmentId = shipment.id;
          }

          if (shipmentId && rfq.shipmentId !== shipmentId) {
            await tx.rfq.update({ where: { id }, data: { shipmentId } });
          }

          const booking = await tx.bookingRequest.create({
            data: {
              rfqId: id,
              quoteId: quote.id,
              shipmentId,
              organizationId: user.organizationId,
              createdByUserId: user.id,
              status: "requested"
            }
          });
          const now = new Date();
          await tx.quote.update({
            where: { id: quote.id },
            data: { status: "accepted", decidedAt: now, decidedByUserId: user.id }
          });
          await tx.quote.updateMany({
            where: { rfqId: id, id: { not: quote.id }, status: "submitted" },
            data: {
              status: "rejected",
              decidedAt: now,
              decidedByUserId: user.id,
              rejectionReason: "Another quote was accepted."
            }
          });
          await tx.rfq.update({ where: { id }, data: { status: "accepted" } });
          return { booking, idempotent: false, providerCompanyId: quote.companyId };
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          const existing = await prisma.bookingRequest.findUnique({
            where: { quoteId: parsed.data.quoteId }
          });
          if (existing) return { ...existing, alreadyAccepted: true };
          return reply.code(409).send({
            error: "This RFQ already has an accepted quote",
            code: "quotation_already_accepted"
          });
        }
        if (error?.code === "quotation_already_accepted") {
          return reply.code(409).send({
            error: "This RFQ already has an accepted quote",
            code: error.code,
            acceptedQuoteId: error.acceptedQuoteId
          });
        }
        if (error?.code === "rfq_not_open") {
          return reply.code(409).send({ error: "This RFQ is no longer open", code: error.code });
        }
        if (error?.code === "quote_not_found") {
          return reply.code(404).send({ error: "Quote not found", code: error.code });
        }
        if (error?.code === "quote_expired") {
          return reply.code(409).send({
            error: "The selected quote has expired",
            code: error.code
          });
        }
        if (error?.code === "quote_not_acceptable") {
          return reply.code(409).send({
            error: "The selected quote cannot be accepted",
            code: error.code,
            status: error.status
          });
        }
        if (error?.code === "shipment_not_found") {
          return reply.code(404).send({ error: "Shipment not found", code: error.code });
        }
        if (error?.code === "shipment_not_bookable") {
          return reply.code(409).send({
            error: "A closed shipment cannot receive a new booking",
            code: error.code,
            status: error.status
          });
        }
        if (error?.code === "rfq_shipment_conflict" || error?.code === "shipment_route_mismatch") {
          return reply.code(409).send({
            error: "The selected shipment does not match the RFQ linkage or route",
            code: error.code
          });
        }
        throw error;
      }

      if (!result) return notFound(reply);
      if (!result.idempotent) {
        await recordAudit({
          organizationId: user.organizationId,
          actorUserId: user.id,
          action: "booking.request",
          entityType: "BookingRequest",
          entityId: result.booking.id,
          metadata: {
            rfqId: id,
            quoteId: parsed.data.quoteId,
            shipmentId: result.booking.shipmentId ?? null
          }
        });
        if (result.providerCompanyId) {
          const company = await prisma.company.findUnique({ where: { id: result.providerCompanyId } });
          if (company?.organizationId) {
            await notify({
              organizationId: company.organizationId,
              type: "QUOTATION_ACCEPTED",
              title: "تم قبول عرضك",
              body: `تم قبول عرضك وإنشاء طلب حجز بانتظار تأكيدك.`,
              dedupeKey: `quote-accepted:${parsed.data.quoteId}`,
              entityType: "BookingRequest",
              entityId: result.booking.id,
              severity: "info"
            });
          }
        }
        const rejected = await prisma.quote.findMany({
          where: { rfqId: id, status: "rejected" },
          select: { id: true, companyId: true }
        });
        for (const rejectedQuote of rejected) {
          if (rejectedQuote.id === parsed.data.quoteId) continue;
          const rejectedCompany = await prisma.company.findUnique({
            where: { id: rejectedQuote.companyId },
            select: { organizationId: true }
          });
          if (rejectedCompany?.organizationId) {
            await notify({
              organizationId: rejectedCompany.organizationId,
              type: "QUOTATION_REJECTED",
              title: "لم يتم اختيار عرضك",
              body: "تم اختيار عرض آخر على طلب العرض.",
              dedupeKey: `quote-rejected:${rejectedQuote.id}`,
              entityType: "Quote",
              entityId: rejectedQuote.id,
              severity: "warning"
            });
          }
        }
      }
      return { ...result.booking, alreadyAccepted: result.idempotent };
    }

    const rfq = devRfqs.find((r) => r.id === id && r.organizationId === user.organizationId);
    if (!rfq) return notFound(reply);
    if (rfq.status === "accepted") {
      const existingQuote = devQuotesList.find((q) => q.rfqId === id && q.status === "accepted");
      if (existingQuote?.id === parsed.data.quoteId) {
        const existing = devBookings.find((b) => b.quoteId === existingQuote.id);
        if (existing) return { ...existing, alreadyAccepted: true, devFallback: true };
      }
      return reply.code(409).send({
        error: "This RFQ already has an accepted quote",
        code: "quotation_already_accepted"
      });
    }
    if (rfq.status !== "submitted") {
      return reply.code(409).send({ error: "This RFQ is no longer open", code: "rfq_not_open" });
    }
    const quote = devQuotesList.find((q) => q.id === parsed.data.quoteId && q.rfqId === id);
    if (!quote) return reply.code(404).send({ error: "Quote not found" });
    if (quote.status !== "submitted") {
      return reply.code(409).send({ error: "The selected quote cannot be accepted", code: "quote_not_acceptable" });
    }
    if (new Date(quote.validityUntil).getTime() <= Date.now()) {
      return reply.code(409).send({ error: "The selected quote has expired", code: "quote_expired" });
    }
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
    }
  );

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
    if (user.scope === "app" && !hasCompanyPermission(user, "bookings.confirm")) {
      return reply.code(403).send({
        error: "Insufficient company permission",
        code: "insufficient_company_permission",
        permission: "bookings.confirm"
      });
    }
    const parsed = z
      .object({
        externalReference: z.string().trim().min(1).max(200).optional(),
        reason: z.string().trim().min(3).max(1000).optional()
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (nextStatus === "confirmed" && !parsed.data.externalReference) {
      return reply.code(400).send({ error: "externalReference is required to confirm a booking" });
    }
    if (nextStatus === "rejected" && !parsed.data.reason) {
      return reply.code(400).send({
        error: "A rejection reason is required",
        code: "rejection_reason_required"
      });
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
      return reply.code(409).send({ error: `Booking is already ${booking.status}`, code: "booking_already_decided" });
    }

    if (prisma) {
      let updated: any;
      try {
        updated = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
          const current = await tx.bookingRequest.findUnique({ where: { id } });
          if (!current) throw Object.assign(new Error("booking_not_found"), { code: "booking_not_found" });
          if (current.status !== "requested") {
            throw Object.assign(new Error("booking_already_decided"), {
              code: "booking_already_decided"
            });
          }
          const now = new Date();
          const decided = await tx.bookingRequest.update({
            where: { id },
            data: {
              status: nextStatus,
              confirmedAt: nextStatus === "confirmed" ? now : null,
              externalReference: nextStatus === "confirmed" ? parsed.data.externalReference : null,
              rejectionReason: nextStatus === "rejected" ? parsed.data.reason : null,
              decidedAt: now,
              decidedByUserId: user.id
            }
          });

          // If the booking was associated with a shipment, a provider
          // confirmation is the only path that moves it to BOOKED. A rejection
          // leaves the shipment status untouched.
          if (nextStatus === "confirmed" && current.shipmentId) {
            const shipment = await tx.shipment.findUnique({ where: { id: current.shipmentId } });
            if (shipment) {
              const transition = validateEventTransition("BOOKING_CONFIRMED", shipment.status);
              if (transition.ok && transition.nextStatus && transition.nextStatus !== shipment.status) {
                await tx.shipment.update({
                  where: { id: shipment.id },
                  data: { status: transition.nextStatus }
                });
              }
              await tx.shipmentEvent.create({
                data: {
                  shipmentId: shipment.id,
                  organizationId: shipment.organizationId,
                  code: "BOOKING_CONFIRMED",
                  label: "Booking confirmed",
                  source: isProvider ? "manual-provider" : "manual-staff",
                  actorUserId: user.id,
                  actorOrganizationId: user.organizationId,
                  idempotencyKey: `booking-confirmed:${id}`,
                  note: parsed.data.externalReference,
                  occurredAt: now
                }
              });
            }
          }
          return decided;
        });
      } catch (error: any) {
        if (error?.code === "booking_not_found") return notFound(reply);
        if (error?.code === "booking_already_decided" || error?.code === "P2002") {
          return reply.code(409).send({
            error: "Booking has already been decided",
            code: "booking_already_decided"
          });
        }
        throw error;
      }

      await recordAudit({
        organizationId: booking.organizationId,
        actorUserId: user.id,
        action: `booking.${nextStatus}`,
        entityType: "BookingRequest",
        entityId: id,
        outcome: "success",
        requestId: request.id,
        metadata: {
          providerCompanyId,
          byPlatformStaff: !isProvider,
          externalReference: parsed.data.externalReference ?? null,
          reason: parsed.data.reason ?? null,
          decidedByUserId: user.id,
          decidedAt: updated.decidedAt
        }
      });
      await notify({
        organizationId: booking.organizationId,
        type: nextStatus === "confirmed" ? "BOOKING_CONFIRMED" : "BOOKING_REJECTED",
        title: nextStatus === "confirmed" ? "تم تأكيد الحجز" : "تم رفض طلب الحجز",
        body:
          nextStatus === "confirmed"
            ? `أكد المزود الحجز${parsed.data.externalReference ? ` بالمرجع ${parsed.data.externalReference}` : ""}.`
            : `تم رفض طلب الحجز: ${parsed.data.reason}`,
        dedupeKey: `booking-${nextStatus}:${id}`,
        entityType: "BookingRequest",
        entityId: id,
        severity: nextStatus === "confirmed" ? "info" : "warning",
        recipientUserIds: [booking.createdByUserId]
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

  app.post(
    "/api/v1/bookings/:id/cancel",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("bookings.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const parsed = z
        .object({ reason: z.string().trim().min(3).max(1000) })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "A cancellation reason is required",
          code: "cancellation_reason_required",
          issues: parsed.error.issues
        });
      }
      const resolved = await bookingWithAuthority(id);
      if (!resolved) return notFound(reply);
      const { booking, providerCompanyId } = resolved;
      const isCustomer = booking.organizationId === user.organizationId;
      const isProvider = providerCompanyId
        ? await organizationOwnsCompany(user.organizationId, providerCompanyId)
        : false;
      const staff = isPlatformStaff(user) && can(user, "bookings.manage");
      if (!isCustomer && !isProvider && !staff) return forbidden(reply);

      if (prisma) {
        try {
          const updated = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`;
            const current = await tx.bookingRequest.findUnique({ where: { id } });
            if (!current) throw Object.assign(new Error("booking_not_found"), { code: "booking_not_found" });
            if (current.status === "cancelled") {
              throw Object.assign(new Error("booking_already_cancelled"), {
                code: "booking_already_cancelled"
              });
            }
            if (current.status === "rejected") {
              throw Object.assign(new Error("booking_already_decided"), {
                code: "booking_already_decided"
              });
            }
            return tx.bookingRequest.update({
              where: { id },
              data: {
                status: "cancelled",
                cancelledAt: new Date(),
                cancellationReason: parsed.data.reason,
                decidedAt: new Date(),
                decidedByUserId: user.id
              }
            });
          });
          await recordAudit({
            organizationId: booking.organizationId,
            actorUserId: user.id,
            action: "booking.cancelled",
            entityType: "BookingRequest",
            entityId: id,
            outcome: "success",
            requestId: request.id,
            metadata: {
              reason: parsed.data.reason,
              byProvider: isProvider,
              byPlatformStaff: staff,
              decidedAt: updated.decidedAt
            }
          });
          const counterPartyOrganizationId = isCustomer
            ? providerCompanyId
              ? (await prisma.company.findUnique({ where: { id: providerCompanyId } }))?.organizationId
              : null
            : booking.organizationId;
          if (counterPartyOrganizationId) {
            await notify({
              organizationId: counterPartyOrganizationId,
              type: "BOOKING_CANCELLED",
              title: "تم إلغاء الحجز",
              body: `تم إلغاء الحجز: ${parsed.data.reason}`,
              dedupeKey: `booking-cancelled:${id}`,
              entityType: "BookingRequest",
              entityId: id,
              severity: "warning"
            });
          }
          return updated;
        } catch (error: any) {
          if (error?.code === "booking_not_found") return notFound(reply);
          if (error?.code === "booking_already_cancelled") {
            return reply.code(409).send({ error: "Booking is already cancelled", code: error.code });
          }
          if (error?.code === "booking_already_decided") {
            return reply.code(409).send({ error: "A rejected booking cannot be cancelled", code: error.code });
          }
          throw error;
        }
      }
      const devBooking = devBookings.find((candidate) => candidate.id === id);
      if (!devBooking) return notFound(reply);
      devBooking.status = "cancelled";
      return { ...devBooking, devFallback: true };
    }
  );

  /**
   * Lists the bookings a caller may act on: the bookings requested by their own
   * organization, plus any booking derived from a quote issued by a company they own.
   * The viewer role is computed server-side and never taken from the client.
   */
  app.get(
    "/api/v1/bookings",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("bookings.read") },
    async (request) => {
    const user = getAuthUser(request);
    const staff = can(user, "bookings.read");

    if (prisma) {
      const companies = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true }
      });
      const companyIds = companies.map((c: any) => c.id);
      const companyIdSet = new Set<string>(companyIds);
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
        include: {
          rfq: { include: { quotes: true } },
          trackingEvents: true,
          shipment: { select: { id: true, status: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      });

      return {
        items: items.map((booking: any) => {
          const quote = (booking.rfq?.quotes ?? []).find((q: any) => q.id === booking.quoteId);
          const isCustomer = booking.organizationId === user.organizationId;
          const isProvider = Boolean(quote && companyIds.includes(quote.companyId));
          const visible =
            isProvider && !isCustomer && !staff
              ? bookingViewForProvider(booking, companyIdSet)
              : booking;
          return {
            ...visible,
            viewerRole: isProvider ? "provider" : isCustomer ? "customer" : "staff"
          };
        })
      };
    }

    const mine = devCompanies.filter((c) => c.organizationId === user.organizationId).map((c) => c.id);
    const mineIdSet = new Set<string>(mine);
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
        const rfq = devRfqs.find((r) => r.id === b.rfqId) ?? null;
        const visibleRfq =
          isProvider && !isCustomer && !staff && rfq
            ? rfqViewForProvider(
                { ...rfq, quotes: devQuotesList.filter((item) => item.rfqId === rfq.id) },
                mineIdSet
              )
            : rfq;
        const visibleBooking =
          isProvider && !isCustomer && !staff
            ? bookingViewForProvider(b, mineIdSet)
            : b;
        return {
          ...visibleBooking,
          rfq: visibleRfq,
          viewerRole: isProvider ? "provider" : isCustomer ? "customer" : "staff",
          devFallback: true
        };
      });
    return { items, devFallback: true };
  });

  app.get("/api/v1/bookings/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope === "app" && !hasCompanyPermission(user, "bookings.read")) {
      return reply.code(403).send({ error: "Insufficient company permission", code: "insufficient_company_permission" });
    }
    const { id } = request.params as { id: string };
    const resolved = await bookingWithAuthority(id);
    if (!resolved) return notFound(reply);
    const { booking, providerCompanyId } = resolved;
    const isCustomer = booking.organizationId === user.organizationId;
    const isProvider = providerCompanyId
      ? await organizationOwnsCompany(user.organizationId, providerCompanyId)
      : false;
    const platformView = can(user, "bookings.read");
    if (!isCustomer && !isProvider && !platformView) return forbidden(reply);
    if (isProvider && !isCustomer && !platformView) {
      if (prisma) {
        const companies = await prisma.company.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true }
        });
        return {
          ...bookingViewForProvider(
            booking,
            new Set<string>(companies.map((company) => company.id))
          ),
          viewerRole: "provider"
        };
      }
      const mine = new Set<string>(
        devCompanies
          .filter((company) => company.organizationId === user.organizationId)
          .map((company) => company.id)
      );
      const rfq = devRfqs.find((candidate) => candidate.id === booking.rfqId) ?? null;
      return {
        ...bookingViewForProvider(booking, mine),
        ...(rfq
          ? {
              rfq: rfqViewForProvider(
                {
                  ...rfq,
                  quotes: devQuotesList.filter((quote) => quote.rfqId === rfq.id)
                },
                mine
              )
            }
          : {}),
        viewerRole: "provider"
      };
    }
    return {
      ...booking,
      viewerRole: isCustomer ? "customer" : isProvider ? "provider" : "staff"
    };
  });

  app.post("/api/v1/bookings/:id/tracking", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope === "app" && !hasCompanyPermission(user, "bookings.tracking")) {
      return reply.code(403).send({
        error: "Insufficient company permission",
        code: "insufficient_company_permission",
        permission: "bookings.tracking"
      });
    }
    const { id } = request.params as { id: string };
    const eventCodes = Object.keys(SHIPMENT_EVENT_DEFINITIONS);
    const parsed = z
      .object({
        code: z.enum(eventCodes as [string, ...string[]]),
        label: z.string().trim().min(1).max(200).optional(),
        note: z.string().trim().max(1000).optional(),
        occurredAt: z.string().datetime({ offset: true }).or(z.string().datetime()).optional(),
        idempotencyKey: z.string().trim().min(8).max(200).optional(),
        source: z.enum(["manual", "imported", "external_verified"]).default("manual")
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    if (parsed.data.source !== "manual") {
      return reply.code(503).send({
        error: "No live tracking integration is configured",
        code: "live_tracking_integration_unavailable"
      });
    }

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
    const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return reply.code(400).send({ error: "Invalid occurredAt", code: "invalid_occurred_at" });
    }
    if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return reply.code(400).send({
        error: "An event cannot be recorded in the future",
        code: "future_event_timestamp"
      });
    }
    const earliest = new Date(booking.createdAt).getTime() - 24 * 60 * 60 * 1000;
    if (occurredAt.getTime() < earliest) {
      return reply.code(400).send({
        error: "The event timestamp precedes the booking record",
        code: "event_before_booking"
      });
    }
    const idempotencyKey = parsed.data.idempotencyKey ?? `manual:${randomUUID()}`;
    const definition = SHIPMENT_EVENT_DEFINITIONS[parsed.data.code as keyof typeof SHIPMENT_EVENT_DEFINITIONS];
    const label = parsed.data.label ?? definition?.label ?? parsed.data.code;

    if (prisma) {
      if (parsed.data.idempotencyKey) {
        const existing = await prisma.trackingEvent.findUnique({
          where: {
            bookingRequestId_idempotencyKey: {
              bookingRequestId: id,
              idempotencyKey: parsed.data.idempotencyKey
            }
          }
        });
        if (existing) return { ...existing, idempotent: true };
      }
      try {
        const event = await prisma.trackingEvent.create({
          data: {
            bookingRequestId: id,
            code: parsed.data.code,
            label,
            metadata: parsed.data.note ? { note: parsed.data.note } : undefined,
            source,
            actorUserId: user.id,
            actorOrganizationId: user.organizationId,
            occurredAt,
            idempotencyKey
          }
        });
        await recordAudit({
          organizationId: booking.organizationId,
          actorUserId: user.id,
          action: "booking.tracking.recorded",
          entityType: "TrackingEvent",
          entityId: event.id,
          outcome: "success",
          requestId: request.id,
          metadata: { bookingId: id, code: parsed.data.code, source }
        });
        return event;
      } catch (error: any) {
        if (error?.code === "P2002") {
          const existing = await prisma.trackingEvent.findUnique({
            where: {
              bookingRequestId_idempotencyKey: {
                bookingRequestId: id,
                idempotencyKey
              }
            }
          });
          if (existing) return { ...existing, idempotent: true };
        }
        throw error;
      }
    }
    const devBooking = devBookings.find((b) => b.id === id);
    if (!devBooking) return notFound(reply);
    const event = {
      id: `dev-te-${devBooking.trackingEvents.length + 1}`,
      code: parsed.data.code,
      label,
      note: parsed.data.note,
      source,
      occurredAt: occurredAt.toISOString()
    };
    devBooking.trackingEvents.push(event);
    return { ...event, devFallback: true };
  });
}

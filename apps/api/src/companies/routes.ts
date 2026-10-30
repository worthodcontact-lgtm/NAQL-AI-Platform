import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { recordAudit } from "../audit/log.js";
import { requireCompanyPermission, hasCompanyPermission } from "../auth/company.js";
import { isProviderCompanyType } from "../auth/account.js";
import {
  createStorageKey,
  extensionForFilename,
  sanitizeDisplayFilename,
  StorageKeyError,
  InvalidFilenameError,
  storageAdapter
} from "../storage/adapter.js";
import { MAX_DOCUMENT_BYTES } from "../config/env.js";
import { FileValidationError, validateFileContent } from "../documents/content.js";
import { scanUpload } from "../documents/malware.js";
import { contentHash, companyDocumentRetention } from "../documents/storage-policy.js";

export const COMPANY_TYPES = [
  "importer_exporter",
  "forwarder",
  "shipping",
  "shipping_agent",
  "carrier",
  "road_carrier",
  "air",
  "air_cargo",
  "customs",
  "warehouse",
  "multimodal"
] as const;

export type CompanyType = (typeof COMPANY_TYPES)[number];

export const PROVIDER_MODES = ["SEA", "AIR", "LAND", "RAIL", "MULTIMODAL"] as const;

/**
 * Broad capability mapping used only for marketplace discovery.
 *
 * It does not assert that a company actually operates a route or has capacity.
 * A provider's published `CompanyService` rows take precedence when present.
 */
const TYPE_MODE_CAPABILITIES: Record<string, readonly string[]> = {
  forwarder: PROVIDER_MODES,
  multimodal: PROVIDER_MODES,
  shipping: ["SEA"],
  shipping_agent: ["SEA"],
  carrier: ["SEA", "LAND", "RAIL"],
  road_carrier: ["LAND"],
  air: ["AIR"],
  air_cargo: ["AIR"],
  customs: PROVIDER_MODES,
  warehouse: PROVIDER_MODES
};

export function companyModeCapabilities(type: string, services: Array<{ mode: string }> = []): string[] {
  const published = services.map((service) => service.mode).filter(Boolean);
  if (published.length > 0) return [...new Set(published)];
  return [...(TYPE_MODE_CAPABILITIES[type] ?? [])];
}

export function companyCanServeMode(
  company: { type: string; services?: Array<{ mode: string }> | null },
  mode: string
): boolean {
  if (company.type === "importer_exporter") return false;
  return companyModeCapabilities(company.type, company.services ?? []).includes(mode);
}

export const COMPANY_TYPE_LABELS: Record<string, string> = {
  importer_exporter: "Importer / Exporter",
  forwarder: "Freight Forwarder",
  shipping: "Shipping Line / Ocean Carrier",
  shipping_agent: "Shipping Agent",
  carrier: "Carrier (legacy)",
  road_carrier: "Road Carrier",
  air: "Air Cargo Provider",
  air_cargo: "Air Cargo Provider",
  customs: "Customs Broker",
  warehouse: "Warehouse / Storage Provider",
  multimodal: "Multimodal Logistics Provider"
};

type DevCompany = {
  id: string;
  name: string;
  nameAr?: string;
  nameEn?: string;
  slug: string;
  type: string;
  status: string;
  verificationStatus: string;
  listed: boolean;
  description?: string;
  country?: string;
  website?: string;
  email?: string;
  phone?: string;
  organizationId?: string;
  recordOrigin?: string;
  dataSource?: string;
  sourceUrl?: string;
  lastVerifiedAt?: string | null;
  publicContactConsent?: boolean;
  pricingIntegrationStatus?: string;
  availabilityIntegrationStatus?: string;
  createdAt: string;
  updatedAt: string;
  services: any[];
  documents: any[];
  reviews: any[];
};

export const devCompanies: DevCompany[] = [];

const registerSchema = z.object({
  name: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200).optional(),
  nameEn: z.string().trim().min(2).max(200).optional(),
  type: z.enum(COMPANY_TYPES),
  description: z.string().trim().max(4000).optional(),
  country: z.string().trim().max(100).optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().max(50).optional(),
  listed: z.boolean().optional(),
  publicContactConsent: z.boolean().optional(),
  services: z
    .array(
      z.object({
        mode: z.enum(PROVIDER_MODES),
        serviceType: z.string().trim().max(100).optional(),
        originLocation: z.string().trim().max(200).optional(),
        destinationLocation: z.string().trim().max(200).optional(),
        shipmentTypes: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
        notes: z.string().trim().max(1000).optional()
      })
    )
    .max(50)
    .optional()
});

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
}

export async function registerCompanyRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/companies/register",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.settings.manage") },
    async (request, reply) => {
    const user = getAuthUser(request);
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (prisma) {
      const slug = `${slugify(input.name)}-${Date.now()}`;
      const company = await prisma.$transaction(async (tx) => {
        const created = await (tx as any).company.create({
          data: {
            name: input.name,
            nameAr: input.nameAr,
            nameEn: input.nameEn,
            slug,
            type: input.type,
            status: "draft",
            verificationStatus: "unregistered",
            listed: input.listed ?? true,
            description: input.description,
            country: input.country,
            website: input.website,
            email: input.email,
            phone: input.phone,
            organizationId: user.organizationId,
            recordOrigin: "user_registered",
            dataSource: "company_profile",
            publicContactConsent: input.publicContactConsent ?? false,
            services: input.services ? { create: input.services } : undefined
          },
          include: { services: true }
        });

        // Creating a logistics provider profile is the explicit step that
        // classifies the organization as a provider. A legacy importer/exporter
        // company record does not grant provider capabilities.
        if (isProviderCompanyType(input.type)) {
          await tx.organization.update({
            where: { id: user.organizationId },
            data: { accountType: "provider" }
          });
        }
        return created;
      });
      await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.register", entityType: "Company", entityId: company.id });
      return company;
    }

    const company: DevCompany = {
      id: `dev-company-${devCompanies.length + 1}`,
      name: input.name,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      slug: `${slugify(input.name)}-${Date.now()}`,
      type: input.type,
      status: "draft",
      verificationStatus: "unregistered",
      listed: input.listed ?? true,
      description: input.description,
      country: input.country,
      website: input.website,
      email: input.email,
      phone: input.phone,
      organizationId: user.organizationId,
      recordOrigin: "user_registered",
      dataSource: "company_profile",
      lastVerifiedAt: null,
      publicContactConsent: input.publicContactConsent ?? false,
      pricingIntegrationStatus: "NOT_CONFIGURED",
      availabilityIntegrationStatus: "NOT_CONFIGURED",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      services: (input.services ?? []).map((s, i) => ({ id: `dev-svc-${i + 1}`, shipmentTypes: [], ...s })),
      documents: [],
      reviews: []
    };
    devCompanies.push(company);
    await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.register", entityType: "Company", entityId: company.id });
    return { ...company, devFallback: true };
    }
  );

  app.get("/api/v1/companies/directory", async (request) => {
    const { q, type, coverage, verificationStatus, mode, serviceType, registered, page, limit } =
      request.query as {
        q?: string;
        type?: string;
        coverage?: string;
        verificationStatus?: string;
        mode?: string;
        serviceType?: string;
        registered?: string;
        page?: string;
        limit?: string;
      };
    const query = q?.trim();
    const coverageQuery = coverage?.trim();
    const parsedPage = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit ?? "12", 10) || 12));
    const registeredFilter =
      registered === "true" ? true : registered === "false" ? false : undefined;
    const serviceWhere = {
      ...(mode ? { mode } : {}),
      ...(serviceType ? { serviceType } : {}),
      ...(coverageQuery
        ? {
            OR: [
              { originLocation: { contains: coverageQuery, mode: "insensitive" as const } },
              { destinationLocation: { contains: coverageQuery, mode: "insensitive" as const } },
              { notes: { contains: coverageQuery, mode: "insensitive" as const } }
            ]
          }
        : {})
    };

    const matches = (c: DevCompany) =>
      c.listed === true &&
      (!type || c.type === type) &&
      (!verificationStatus || c.verificationStatus === verificationStatus) &&
      (registeredFilter === undefined || (registeredFilter ? Boolean(c.organizationId) : !c.organizationId)) &&
      (!query ||
        `${c.name} ${c.nameAr ?? ""} ${c.nameEn ?? ""} ${c.country ?? ""} ${c.type} ${(c.services ?? [])
          .map((s: any) => `${s.mode} ${s.serviceType ?? ""} ${s.originLocation ?? ""} ${s.destinationLocation ?? ""}`)
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())) &&
      (!mode || (c.services ?? []).some((s: any) => s.mode === mode)) &&
      (!serviceType || (c.services ?? []).some((s: any) => s.serviceType === serviceType)) &&
      (!coverageQuery ||
        (c.services ?? []).some((s: any) =>
          `${s.originLocation ?? ""} ${s.destinationLocation ?? ""} ${s.notes ?? ""}`
            .toLocaleLowerCase()
            .includes(coverageQuery.toLocaleLowerCase())
        ));

    const publicView = (company: any) => ({
      id: company.id,
      name: company.name,
      nameAr: company.nameAr ?? null,
      nameEn: company.nameEn ?? null,
      slug: company.slug,
      type: company.type,
      country: company.country ?? null,
      website: company.website ?? null,
      // Contact fields are only published with explicit consent.
      email: company.publicContactConsent ? company.email ?? null : null,
      phone: company.publicContactConsent ? company.phone ?? null : null,
      contactPublished: Boolean(company.publicContactConsent && (company.email || company.phone)),
      verificationStatus: company.verificationStatus,
      listed: company.listed,
      status: company.status,
      description: company.description ?? null,
      isRegistered: Boolean(company.organizationId),
      recordOrigin: company.recordOrigin ?? "user_registered",
      dataSource: company.dataSource ?? (company.organizationId ? "company_profile" : null),
      sourceUrl: company.sourceUrl ?? null,
      lastVerifiedAt: company.lastVerifiedAt ?? null,
      pricingIntegrationStatus: company.pricingIntegrationStatus ?? "NOT_CONFIGURED",
      availabilityIntegrationStatus: company.availabilityIntegrationStatus ?? "NOT_CONFIGURED",
      services: (company.services ?? []).map((service: any) => ({
        id: service.id,
        mode: service.mode,
        serviceType: service.serviceType ?? null,
        originLocation: service.originLocation ?? null,
        destinationLocation: service.destinationLocation ?? null,
        shipmentTypes: service.shipmentTypes ?? [],
        notes: service.notes ?? null
      })),
      updatedAt: company.updatedAt
    });

    if (prisma) {
      const where: any = {
        listed: true,
        ...(type ? { type } : {}),
        ...(verificationStatus ? { verificationStatus } : {}),
        ...(registeredFilter === true ? { organizationId: { not: null } } : {}),
        ...(registeredFilter === false ? { organizationId: null } : {}),
        ...(Object.keys(serviceWhere).length ? { services: { some: serviceWhere } } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { nameAr: { contains: query, mode: "insensitive" } },
                { nameEn: { contains: query, mode: "insensitive" } },
                { country: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
                {
                  services: {
                    some: {
                      OR: [
                        { mode: { contains: query, mode: "insensitive" } },
                        { serviceType: { contains: query, mode: "insensitive" } },
                        { originLocation: { contains: query, mode: "insensitive" } },
                        { destinationLocation: { contains: query, mode: "insensitive" } }
                      ]
                    }
                  }
                }
              ]
            }
          : {})
      };
      const [total, items] = await Promise.all([
        (prisma as any).company.count({ where }),
        (prisma as any).company.findMany({
          where,
          select: {
            id: true, name: true, nameAr: true, nameEn: true, slug: true, type: true,
            country: true, website: true, email: true, phone: true,
            verificationStatus: true, listed: true, status: true, description: true,
            organizationId: true, recordOrigin: true, dataSource: true, sourceUrl: true,
            lastVerifiedAt: true, publicContactConsent: true,
            pricingIntegrationStatus: true, availabilityIntegrationStatus: true,
            services: {
              select: {
                id: true, mode: true, serviceType: true, originLocation: true,
                destinationLocation: true, shipmentTypes: true, notes: true
              }
            },
            updatedAt: true
          },
          orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
          skip: (parsedPage - 1) * pageSize,
          take: pageSize
        })
      ]);
      return {
        items: items.map(publicView),
        total,
        page: parsedPage,
        pageSize,
        hasMore: parsedPage * pageSize < total,
        disclaimer:
          "Directory records describe providers; they are not an endorsement, a verified capacity statement, or a live price. Registered accounts and public directory entries are shown separately."
      };
    }

    const filtered = devCompanies.filter(matches);
    const start = (parsedPage - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize).map(publicView),
      total: filtered.length,
      page: parsedPage,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      devFallback: true,
      disclaimer:
        "Directory records describe providers; they are not an endorsement, a verified capacity statement, or a live price. Registered accounts and public directory entries are shown separately."
    };
  });

  app.get(
    "/api/v1/companies/mine",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.settings.read") },
    async (request) => {
    const user = getAuthUser(request);
    const canReadDocuments = hasCompanyPermission(user, "company.documents.read");
    if (prisma) {
      const items = await (prisma as any).company.findMany({
        where: { organizationId: user.organizationId },
        select: {
          id: true,
          name: true,
          nameAr: true,
          nameEn: true,
          slug: true,
          type: true,
          status: true,
          verificationStatus: true,
          listed: true,
          description: true,
          country: true,
          website: true,
          email: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          recordOrigin: true,
          dataSource: true,
          sourceUrl: true,
          lastVerifiedAt: true,
          publicContactConsent: true,
          pricingIntegrationStatus: true,
          availabilityIntegrationStatus: true,
          services: true,
          reviews: true,
          // Internal storage locations are never returned. Metadata is limited to
          // company roles that explicitly hold `company.documents.read`.
          ...(canReadDocuments
            ? {
                documents: {
                  select: {
                    id: true,
                    type: true,
                    filename: true,
                    status: true,
                    reviewNote: true,
                    uploadedAt: true
                  }
                }
              }
            : {})
        }
      });
      return { items };
    }
    return {
      items: devCompanies
        .filter((c) => c.organizationId === user.organizationId)
        .map((c) => ({
          ...c,
          documents: canReadDocuments
            ? (c.documents ?? []).map((document: any) => ({
                id: document.id,
                type: document.type,
                filename: document.filename,
                status: document.status,
                reviewNote: document.reviewNote ?? null,
                uploadedAt: document.uploadedAt
              }))
            : []
        })),
      devFallback: true
    };
  }
  );

  app.get("/api/v1/companies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (prisma) {
      // The public profile is part of the directory contract: an unlisted
      // company must not be discoverable by guessing or sharing its identifier.
      // Owners read unlisted records through `/api/v1/companies/mine`.
      const company = await (prisma as any).company.findFirst({
        where: { id, listed: true },
        select: {
          id: true, name: true, nameAr: true, nameEn: true, slug: true, type: true,
          status: true, verificationStatus: true, listed: true, description: true,
          country: true, website: true, email: true, phone: true, organizationId: true,
          recordOrigin: true, dataSource: true, sourceUrl: true, lastVerifiedAt: true,
          publicContactConsent: true, pricingIntegrationStatus: true,
          availabilityIntegrationStatus: true, services: true, updatedAt: true
        }
      });
      if (!company) return notFound(reply);
      return {
        ...company,
        email: company.publicContactConsent ? company.email : null,
        phone: company.publicContactConsent ? company.phone : null,
        contactPublished: Boolean(
          company.publicContactConsent && (company.email || company.phone)
        ),
        isRegistered: Boolean(company.organizationId),
        organizationId: undefined
      };
    }
    const company = devCompanies.find((c) => c.id === id && c.listed === true);
    if (!company) return notFound(reply);
    const {
      email,
      phone,
      organizationId,
      documents: _documents,
      createdByUserId: _createdByUserId,
      ...publicFields
    } = company as any;
    return {
      ...publicFields,
      email: company.publicContactConsent ? email : null,
      phone: company.publicContactConsent ? phone : null,
      contactPublished: Boolean(company.publicContactConsent && (email || phone)),
      isRegistered: Boolean(organizationId),
      devFallback: true
    };
  });

  app.post(
    "/api/v1/companies/:id/submit",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.settings.manage") },
    async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const company = await (prisma as any).company.findUnique({ where: { id } });
      if (!company || company.organizationId !== user.organizationId) return notFound(reply);
      if (!["draft", "needs_information"].includes(company.status)) return reply.code(409).send({ error: "Company is not in a submittable state" });
      const updated = await (prisma as any).company.update({ where: { id }, data: { status: "submitted", verificationStatus: "pending" } });
      await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.submit", entityType: "Company", entityId: id });
      return updated;
    }
    const company = devCompanies.find((c) => c.id === id && c.organizationId === user.organizationId);
    if (!company) return notFound(reply);
    if (!["draft", "needs_information"].includes(company.status)) return reply.code(409).send({ error: "Company is not in a submittable state" });
    company.status = "submitted";
    company.verificationStatus = "pending";
    company.updatedAt = new Date().toISOString();
    await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.submit", entityType: "Company", entityId: id });
    return { ...company, devFallback: true };
    }
  );

  const COMPANY_DOCUMENT_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
  const companyDocumentUploadSchema = z.object({
    type: z.enum(["commercial_register", "tax_card", "license", "insurance", "other"]),
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1),
    size: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
    dataBase64: z.string().min(1)
  });

  function companyDocumentView(document: any) {
    return {
      id: document.id,
      companyId: document.companyId,
      type: document.type,
      filename: document.filename,
      contentType: document.contentType ?? null,
      size: document.size ?? null,
      contentHash: document.contentHash ?? null,
      malwareScanStatus: document.malwareScanStatus ?? "not_scanned",
      retentionUntil: document.retentionUntil ?? null,
      status: document.status,
      reviewNote: document.reviewNote,
      uploadedAt: document.uploadedAt,
      hasContent: !document.deletedAt && document.status !== "metadata_only"
    };
  }

  /**
   * Organization-authorized company verification document upload.
   *
   * The client never supplies a storage key. The filename is display metadata
   * only and the object is stored under a server-generated key outside the web
   * root. Only PDF, PNG and JPEG bytes that pass signature validation are
   * accepted, and a configured scanner can quarantine the file before storage.
   */
  app.post(
    "/api/v1/companies/:id/documents",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.documents.manage") },
    async (request, reply) => {
      if (!prisma) {
        return reply.code(503).send({
          error: "Secure company document upload requires the PostgreSQL persistence layer",
          code: "database_required"
        });
      }
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const company = await prisma.company.findFirst({
        where: { id, organizationId: user.organizationId }
      });
      if (!company) return notFound(reply);

      const parsed = companyDocumentUploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      }
      const input = parsed.data;
      if (!COMPANY_DOCUMENT_CONTENT_TYPES.has(input.contentType)) {
        return reply.code(415).send({
          error: "Only PDF, PNG and JPEG verification documents are accepted",
          code: "unsupported_company_document_type"
        });
      }

      let filename: string;
      let storageKey: string;
      try {
        filename = sanitizeDisplayFilename(input.filename);
        storageKey = createStorageKey(
          ["companies", id, "documents"],
          extensionForFilename(filename)
        );
      } catch (error) {
        if (error instanceof InvalidFilenameError || error instanceof StorageKeyError) {
          return reply.code(400).send({ error: error.message, code: error.code });
        }
        throw error;
      }

      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64) || input.dataBase64.length % 4 !== 0) {
        return reply.code(400).send({ error: "Invalid base64 payload", code: "invalid_base64" });
      }
      const data = Buffer.from(input.dataBase64, "base64");
      if (data.length !== input.size) {
        return reply.code(400).send({ error: "Declared size does not match payload" });
      }
      if (data.length > MAX_DOCUMENT_BYTES) {
        return reply.code(413).send({ error: "Payload too large" });
      }

      let contentType = input.contentType;
      let scanStatus = "not_scanned";
      let scanDetail: Record<string, unknown> | null = null;
      try {
        const validated = validateFileContent({
          buffer: data,
          filename,
          declaredContentType: input.contentType
        });
        contentType = validated.contentType;
        const scan = await scanUpload(data);
        scanStatus = scan.status;
        scanDetail = {
          provider: scan.provider,
          status: scan.status,
          signature: scan.signature ?? null,
          message: scan.message
        };
      } catch (error) {
        if (error instanceof FileValidationError) {
          return reply.code(error.statusCode).send({ error: error.message, code: error.code });
        }
        throw error;
      }

      try {
        await storageAdapter.put(storageKey, data, contentType);
      } catch {
        return reply.code(503).send({
          error: "Secure document storage is temporarily unavailable",
          code: "storage_unavailable",
          stored: false
        });
      }

      let document: any;
      try {
        document = await prisma.companyDocument.create({
          data: {
            companyId: id,
            type: input.type,
            filename,
            storageKey,
            contentType,
            size: data.length,
            contentHash: contentHash(data),
            organizationId: user.organizationId,
            uploadedByUserId: user.id,
            malwareScanStatus: scanStatus,
            malwareScanDetail: scanDetail as any,
            retentionUntil: companyDocumentRetention(),
            status: "uploaded"
          }
        });
      } catch (error) {
        await storageAdapter.delete(storageKey).catch(() => undefined);
        throw error;
      }

      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "company.document.uploaded",
        entityType: "CompanyDocument",
        entityId: document.id,
        outcome: "success",
        requestId: request.id,
        metadata: {
          companyId: id,
          contentType,
          size: data.length,
          malwareScanStatus: scanStatus
        }
      });
      return { ...companyDocumentView(document), malwareScan: scanDetail };
    }
  );

  app.get(
    "/api/v1/companies/:id/documents",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.documents.read") },
    async (request, reply) => {
      if (!prisma) {
        return reply.code(503).send({ error: "Database required", code: "database_required" });
      }
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const company = await prisma.company.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true }
      });
      if (!company) return notFound(reply);
      const items = await prisma.companyDocument.findMany({
        where: { companyId: id, deletedAt: null },
        orderBy: { uploadedAt: "desc" },
        take: 100
      });
      return { items: items.map(companyDocumentView) };
    }
  );

  app.get(
    "/api/v1/companies/:id/documents/:documentId/content",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.documents.read") },
    async (request, reply) => {
      if (!prisma) {
        return reply.code(503).send({ error: "Database required", code: "database_required" });
      }
      const user = getAuthUser(request);
      const { id, documentId } = request.params as { id: string; documentId: string };
      const company = await prisma.company.findFirst({
        where: { id, organizationId: user.organizationId },
        select: { id: true }
      });
      if (!company) return notFound(reply);
      const document = await prisma.companyDocument.findFirst({
        where: { id: documentId, companyId: id, deletedAt: null }
      });
      if (!document) return notFound(reply);
      if (document.malwareScanStatus === "infected") {
        return reply.code(403).send({
          error: "This document is quarantined by the malware scanner",
          code: "document_quarantined"
        });
      }
      if (document.status === "metadata_only") {
        return reply.code(404).send({
          error: "This document has no stored bytes",
          code: "document_bytes_unavailable"
        });
      }

      let bytes: Buffer;
      try {
        bytes = await storageAdapter.read(document.storageKey);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          return reply.code(404).send({
            error: "The stored object is missing",
            code: "stored_object_missing"
          });
        }
        return reply.code(503).send({
          error: "Secure document storage is temporarily unavailable",
          code: "storage_unavailable"
        });
      }

      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "company.document.downloaded",
        entityType: "CompanyDocument",
        entityId: document.id,
        outcome: "success",
        requestId: request.id,
        metadata: { companyId: id, contentType: document.contentType, size: bytes.length }
      });

      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, no-store");
      reply.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`
      );
      reply.type(document.contentType ?? "application/octet-stream");
      return bytes;
    }
  );
}

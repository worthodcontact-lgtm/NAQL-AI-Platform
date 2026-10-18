import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { isPlatformStaff } from "../auth/roles.js";
import { recordAudit } from "../audit/log.js";

export const COMPANY_TYPES = ["forwarder", "carrier", "shipping", "air", "customs", "warehouse"] as const;

type DevCompany = {
  id: string;
  name: string;
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
  createdAt: string;
  updatedAt: string;
  services: any[];
  documents: any[];
  reviews: any[];
};

export const devCompanies: DevCompany[] = [];

const registerSchema = z.object({
  name: z.string().min(2),
  type: z.enum(COMPANY_TYPES),
  description: z.string().optional(),
  country: z.string().optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  listed: z.boolean().optional(),
  services: z.array(z.object({ mode: z.string().min(1), originLocation: z.string().optional(), destinationLocation: z.string().optional(), notes: z.string().optional() })).optional()
});

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_information"]),
  notes: z.string().optional()
});

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }
function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
}

export async function registerCompanyRoutes(app: FastifyInstance) {
  app.post("/api/v1/companies/register", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (prisma) {
      const slug = `${slugify(input.name)}-${Date.now()}`;
      const company = await (prisma as any).company.create({
        data: {
          name: input.name,
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
          services: input.services ? { create: input.services } : undefined
        },
        include: { services: true }
      });
      await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.register", entityType: "Company", entityId: company.id });
      return company;
    }

    const company: DevCompany = {
      id: `dev-company-${devCompanies.length + 1}`,
      name: input.name,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      services: (input.services ?? []).map((s, i) => ({ id: `dev-svc-${i + 1}`, ...s })),
      documents: [],
      reviews: []
    };
    devCompanies.push(company);
    await recordAudit({ organizationId: user.organizationId, actorUserId: user.id, action: "company.register", entityType: "Company", entityId: company.id });
    return { ...company, devFallback: true };
  });

  app.get("/api/v1/companies/directory", async (request) => {
    const { q, type } = request.query as { q?: string; type?: string };
    const matches = (c: any) =>
      c.listed === true &&
      (!type || c.type === type) &&
      (!q || `${c.name} ${c.country ?? ""} ${c.type}`.toLowerCase().includes(q.toLowerCase()));

    if (prisma) {
      const items = await (prisma as any).company.findMany({
        where: { listed: true, ...(type ? { type } : {}), ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
        select: { id: true, name: true, slug: true, type: true, country: true, verificationStatus: true, listed: true, status: true, description: true },
        take: 100
      });
      return { items, disclaimer: "Directory listing is not an endorsement or verified partnership." };
    }
    return { items: devCompanies.filter(matches), devFallback: true, disclaimer: "Directory listing is not an endorsement or verified partnership." };
  });

  app.get("/api/v1/companies/mine", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    if (prisma) {
      const items = await (prisma as any).company.findMany({ where: { organizationId: user.organizationId }, include: { services: true, documents: true, reviews: true } });
      return { items };
    }
    return { items: devCompanies.filter((c) => c.organizationId === user.organizationId), devFallback: true };
  });

  app.get("/api/v1/companies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (prisma) {
      const company = await (prisma as any).company.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, type: true, status: true, verificationStatus: true, listed: true, description: true, country: true, website: true, services: true }
      });
      if (!company) return notFound(reply);
      return company;
    }
    const company = devCompanies.find((c) => c.id === id);
    if (!company) return notFound(reply);
    const { email, phone, organizationId, ...publicFields } = company;
    return { ...publicFields, devFallback: true };
  });

  app.post("/api/v1/companies/:id/submit", { onRequest: [app.authenticate] }, async (request, reply) => {
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
  });

  app.post("/api/v1/companies/:id/documents", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const parsed = z.object({ type: z.string().min(1), filename: z.string().min(1), storageKey: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    if (prisma) {
      const company = await (prisma as any).company.findUnique({ where: { id } });
      if (!company || company.organizationId !== user.organizationId) return notFound(reply);
      const doc = await (prisma as any).companyDocument.create({ data: { companyId: id, ...parsed.data, status: "uploaded" } });
      return doc;
    }
    const company = devCompanies.find((c) => c.id === id && c.organizationId === user.organizationId);
    if (!company) return notFound(reply);
    const doc = { id: `dev-cdoc-${company.documents.length + 1}`, ...parsed.data, status: "uploaded", uploadedAt: new Date().toISOString() };
    company.documents.push(doc);
    return { ...doc, devFallback: true };
  });

  app.post("/api/v1/admin/companies/:id/verify", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!isPlatformStaff(user)) return forbidden(reply);
    const { id } = request.params as { id: string };
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const decision = parsed.data.decision;

    const statusMap: Record<string, { status: string; verificationStatus: string }> = {
      approved: { status: "approved", verificationStatus: "verified" },
      rejected: { status: "rejected", verificationStatus: "rejected" },
      needs_information: { status: "needs_information", verificationStatus: "pending" }
    };
    const next = statusMap[decision];

    if (prisma) {
      const company = await (prisma as any).company.findUnique({ where: { id } });
      if (!company) return notFound(reply);
      const updated = await (prisma as any).company.update({ where: { id }, data: next });
      await (prisma as any).verificationReview.create({ data: { companyId: id, reviewerUserId: user.id, decision, notes: parsed.data.notes } });
      await recordAudit({ actorUserId: user.id, action: `company.verify.${decision}`, entityType: "Company", entityId: id });
      return updated;
    }

    const company = devCompanies.find((c) => c.id === id);
    if (!company) return notFound(reply);
    company.status = next.status;
    company.verificationStatus = next.verificationStatus;
    company.updatedAt = new Date().toISOString();
    company.reviews.push({ id: `dev-rev-${company.reviews.length + 1}`, reviewerUserId: user.id, decision, notes: parsed.data.notes, createdAt: new Date().toISOString() });
    await recordAudit({ actorUserId: user.id, action: `company.verify.${decision}`, entityType: "Company", entityId: id });
    return { ...company, devFallback: true };
  });
}

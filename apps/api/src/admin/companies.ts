import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { recordAudit } from "../audit/log.js";
import {
  AdminActionError,
  listQuerySchema,
  pageResult,
  pagination,
  requirePermission,
  sendAdminActionError,
  sendError
} from "./shared.js";

const COMPANY_TYPES = ["forwarder", "carrier", "shipping", "air", "customs", "warehouse"] as const;

const companiesQuerySchema = listQuerySchema.extend({
  verificationStatus: z.enum(["unregistered", "pending", "verified", "rejected"]).optional(),
  type: z.enum(COMPANY_TYPES).optional(),
  status: z.enum(["draft", "pending", "approved", "rejected", "needs_information"]).optional()
});

const reviewSchema = z
  .object({
    decision: z.enum(["approved", "rejected", "needs_information"]),
    notes: z.string().trim().max(2000).optional()
  })
  .superRefine((value, ctx) => {
    if (value.decision !== "approved" && (!value.notes || value.notes.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["notes"],
        message: "A documented reason is required for rejected or needs_information decisions"
      });
    }
  });

const DECISION_MAP: Record<string, { status: string; verificationStatus: string }> = {
  approved: { status: "approved", verificationStatus: "verified" },
  rejected: { status: "rejected", verificationStatus: "rejected" },
  needs_information: { status: "needs_information", verificationStatus: "pending" }
};

export async function registerAdminCompanyRoutes(app: FastifyInstance) {
  const base = "/api/v1/admin/companies";

  app.get(base, { onRequest: [app.authenticate], preHandler: requirePermission("companies.read") }, async (request, reply) => {
    const parsed = companiesQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, verificationStatus, type, status } = parsed.data;
    const p = pagination(parsed.data);
    const db = prisma!;

    const where: any = {};
    if (verificationStatus) where.verificationStatus = verificationStatus;
    if (type) where.type = type;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } }
      ];
    }

    const [items, total] = await Promise.all([
      db.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          type: true,
          status: true,
          verificationStatus: true,
          listed: true,
          country: true,
          email: true,
          organizationId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { services: true, documents: true, reviews: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: p.skip,
        take: p.take
      }),
      db.company.count({ where })
    ]);

    return pageResult(items, total, p);
  });

  app.get(`${base}/:id`, { onRequest: [app.authenticate], preHandler: requirePermission("companies.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = prisma!;

    const company = await db.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
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
        organizationId: true,
        createdAt: true,
        updatedAt: true,
        services: true,
        // storageKey is an internal location and is intentionally not exposed.
        documents: {
          select: { id: true, type: true, filename: true, status: true, reviewNote: true, uploadedAt: true },
          orderBy: { uploadedAt: "desc" }
        },
        reviews: { orderBy: { createdAt: "desc" }, take: 50 }
      }
    });
    if (!company) return sendError(reply, 404, "company_not_found", "Company not found");

    const organization = company.organizationId
      ? await db.organization.findUnique({
          where: { id: company.organizationId },
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            memberships: {
              select: {
                id: true,
                role: true,
                user: { select: { id: true, email: true, displayName: true, status: true } }
              },
              take: 100
            }
          }
        })
      : null;

    return { company, organization };
  });

  /**
   * Verification decision. This records a platform review, not a claim that a
   * government authority confirmed the company.
   */
  app.post(
    `${base}/:id/verify`,
    { onRequest: [app.authenticate], preHandler: requirePermission("companies.verify") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reviewSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

      const actor = getAuthUser(request);
      const db = prisma!;
      const decision = parsed.data.decision;
      const next = DECISION_MAP[decision];

      try {
        const updated = await db.$transaction(async (tx) => {
          const company = await tx.company.findUnique({
            where: { id },
            select: { id: true, name: true, organizationId: true, verificationStatus: true }
          });
          if (!company) throw new AdminActionError(404, "company_not_found", "Company not found");
          if (company.organizationId && company.organizationId === actor.organizationId) {
            throw new AdminActionError(
              409,
              "cannot_verify_own_company",
              "You cannot verify a company owned by your own organization"
            );
          }

          const result = await tx.company.update({
            where: { id },
            data: next,
            select: { id: true, name: true, status: true, verificationStatus: true, updatedAt: true }
          });
          await tx.verificationReview.create({
            data: {
              companyId: id,
              reviewerUserId: actor.id,
              decision,
              notes: parsed.data.notes ?? null
            }
          });

          await recordAudit(
            {
              actorUserId: actor.id,
              actorRole: actor.platformRole,
              action: `company.verify.${decision}`,
              entityType: "Company",
              entityId: id,
              outcome: "success",
              requestId: request.id,
              metadata: {
                companyName: company.name,
                previousVerificationStatus: company.verificationStatus,
                nextVerificationStatus: next.verificationStatus,
                notes: parsed.data.notes ?? null
              }
            },
            { client: tx, throwOnError: true }
          );

          return result;
        });

        return { company: updated };
      } catch (error) {
        return sendAdminActionError(reply, error);
      }
    }
  );
}

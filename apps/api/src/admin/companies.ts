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
import { storageAdapter } from "../storage/adapter.js";
import { COMPANY_TYPES } from "../companies/routes.js";

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

/**
 * Approval requires a file that actually exists at a server-managed company
 * document key and was not quarantined by the malware scanner. A database row,
 * filename, or client-supplied storageKey alone is never evidence.
 */
async function hasVerificationEvidence(
  tx: { companyDocument: { findMany: (args: any) => Promise<Array<{ storageKey: string }>> } },
  companyId: string
): Promise<boolean> {
  const documents = await tx.companyDocument.findMany({
    where: {
      companyId,
      status: "uploaded",
      deletedAt: null,
      malwareScanStatus: { not: "infected" }
    },
    select: { storageKey: true }
  });
  const expectedPrefix = `companies/${companyId}/documents/`;
  for (const document of documents) {
    if (!document.storageKey.startsWith(expectedPrefix)) continue;
    if (await storageAdapter.exists(document.storageKey)) return true;
  }
  return false;
}

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
        // Verification documents are exposed only through the dedicated endpoint
        // that checks `companies.documents.read`, requires a reason, and audits it.
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
   * Verification documents.
   *
   * These are commercial documents supplied by the company. They are not part
   * of the ordinary company profile and are not available to support agents.
   * Access requires `companies.documents.read`, a documented reason, and is
   * recorded in the audit log.
   */
  app.get(
    `${base}/:id/documents`,
    { onRequest: [app.authenticate], preHandler: requirePermission("companies.documents.read") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, "reason_required", "A documented reason is required", {
          issues: parsed.error.issues
        });
      }
      const actor = getAuthUser(request);
      const db = prisma!;

      const company = await db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          organizationId: true,
          // storageKey is an internal location and is intentionally not exposed.
          documents: {
            select: {
              id: true,
              type: true,
              filename: true,
              contentType: true,
              size: true,
              malwareScanStatus: true,
              status: true,
              reviewNote: true,
              uploadedAt: true
            },
            where: { deletedAt: null },
            orderBy: { uploadedAt: "desc" }
          }
        }
      });
      if (!company) return sendError(reply, 404, "company_not_found", "Company not found");

      await recordAudit({
        organizationId: company.organizationId ?? undefined,
        actorUserId: actor.id,
        actorRole: actor.platformRole,
        action: "admin.company.documents.accessed",
        entityType: "Company",
        entityId: id,
        outcome: "success",
        requestId: request.id,
        metadata: { reason: parsed.data.reason, documentCount: company.documents.length }
      });

      return { company };
    }
  );

  app.get(
    `${base}/:id/documents/:documentId/content`,
    { onRequest: [app.authenticate], preHandler: requirePermission("companies.documents.read") },
    async (request, reply) => {
      const { id, documentId } = request.params as { id: string; documentId: string };
      const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, "reason_required", "A documented reason is required", {
          issues: parsed.error.issues
        });
      }
      const actor = getAuthUser(request);
      const db = prisma!;
      const company = await db.company.findUnique({
        where: { id },
        select: { id: true, organizationId: true }
      });
      if (!company) return sendError(reply, 404, "company_not_found", "Company not found");
      const document = await db.companyDocument.findFirst({
        where: { id: documentId, companyId: id, deletedAt: null }
      });
      if (!document) {
        return sendError(reply, 404, "document_not_found", "Company document not found");
      }
      if (document.malwareScanStatus === "infected") {
        return sendError(
          reply,
          403,
          "document_quarantined",
          "This document is quarantined by the malware scanner"
        );
      }
      if (document.status === "metadata_only") {
        return sendError(
          reply,
          404,
          "document_bytes_unavailable",
          "This document has no stored bytes"
        );
      }

      let bytes: Buffer;
      try {
        bytes = await storageAdapter.read(document.storageKey);
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          return sendError(reply, 404, "stored_object_missing", "The stored object is missing");
        }
        return sendError(
          reply,
          503,
          "storage_unavailable",
          "Secure document storage is temporarily unavailable"
        );
      }

      await recordAudit({
        organizationId: company.organizationId ?? undefined,
        actorUserId: actor.id,
        actorRole: actor.platformRole,
        action: "admin.company.document.downloaded",
        entityType: "CompanyDocument",
        entityId: document.id,
        outcome: "success",
        requestId: request.id,
        metadata: {
          reason: parsed.data.reason,
          companyId: id,
          contentType: document.contentType,
          size: bytes.length
        }
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
      const next = {
        ...DECISION_MAP[decision],
        // A platform approval is the first independent review date. Rejections
        // and pending decisions do not claim an independent verification date.
        lastVerifiedAt: decision === "approved" ? new Date() : null
      };

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

          if (decision === "approved" && !(await hasVerificationEvidence(tx, id))) {
            throw new AdminActionError(
              409,
              "verification_evidence_required",
              "Approval requires a stored verification document. Upload and review evidence before approving."
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

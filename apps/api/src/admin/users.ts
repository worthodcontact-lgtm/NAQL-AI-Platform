import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { PLATFORM_ROLES, PlatformRole } from "../auth/permissions.js";
import { recordAudit } from "../audit/log.js";
import {
  AdminActionError,
  listQuerySchema,
  pageResult,
  pagination,
  parseDate,
  requirePermission,
  safeMetadata,
  safeUserSelect,
  sendAdminActionError,
  sendError
} from "./shared.js";
import { isLastActiveSuperAdmin, lockSuperAdminInvariant } from "./super-admin.js";

const roleSchema = z.enum(["SUPER_ADMIN", "ADMIN", "REVIEWER", "SUPPORT"]);

const dateParam = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

const usersQuerySchema = listQuerySchema.extend({
  status: z.enum(["active", "suspended"]).optional(),
  platformRole: z.enum(["SUPER_ADMIN", "ADMIN", "REVIEWER", "SUPPORT", "none"]).optional(),
  organizationId: z.string().trim().max(64).optional(),
  createdFrom: dateParam,
  createdTo: dateParam
});

const suspendSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

const reactivateSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional()
});

const roleChangeSchema = z.object({
  role: roleSchema.nullable(),
  reason: z.string().trim().min(3).max(500)
});

export async function registerAdminUserRoutes(app: FastifyInstance) {
  const base = "/api/v1/admin/users";

  app.get(base, { onRequest: [app.authenticate], preHandler: requirePermission("users.read") }, async (request, reply) => {
    const parsed = usersQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, status, platformRole, organizationId, createdFrom, createdTo } = parsed.data;
    const p = pagination(parsed.data);
    const db = prisma!;

    const where: any = {};
    if (status) where.status = status;
    if (platformRole === "none") where.platformRole = null;
    else if (platformRole) where.platformRole = platformRole;
    if (organizationId) where.organizationId = organizationId;

    const createdRange: any = {};
    const from = parseDate(createdFrom);
    const to = parseDate(createdTo, true);
    if (from) createdRange.gte = from;
    if (to) createdRange.lte = to;
    if (Object.keys(createdRange).length) where.createdAt = createdRange;

    if (q) {
      where.OR = [
        { email: { contains: q, mode: "insensitive" } },
        { displayName: { contains: q, mode: "insensitive" } },
        { id: q },
        { organization: { name: { contains: q, mode: "insensitive" } } }
      ];
    }

    const [items, total] = await Promise.all([
      db.user.findMany({ where, select: safeUserSelect, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
      db.user.count({ where })
    ]);

    return pageResult(items, total, p);
  });

  app.get(`${base}/:id`, { onRequest: [app.authenticate], preHandler: requirePermission("users.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = prisma!;

    const user = await db.user.findUnique({
      where: { id },
      select: safeUserSelect
    });
    if (!user) return sendError(reply, 404, "user_not_found", "User not found");

    // Companies owned are derived from the user's primary organization. This is
    // an explicit tenant-scoped query, never a cross-tenant traversal.
    const ownedCompanies = user.organizationId
      ? await db.company.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true, name: true, type: true, status: true, verificationStatus: true },
          take: 50
        })
      : [];

    const activity = await db.auditLog.findMany({
      where: { actorUserId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        outcome: true,
        requestId: true,
        metadata: true,
        createdAt: true
      }
    });

    return {
      user,
      ownedCompanies,
      recentActivity: activity.map((entry) => ({ ...entry, metadata: safeMetadata(entry.metadata) }))
    };
  });

  app.post(
    `${base}/:id/suspend`,
    { onRequest: [app.authenticate], preHandler: requirePermission("users.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = suspendSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

      const actor = getAuthUser(request);
      const db = prisma!;

      try {
        const updated = await db.$transaction(async (tx) => {
          await lockSuperAdminInvariant(tx);

          const target = await tx.user.findUnique({
            where: { id },
            select: { id: true, email: true, status: true, platformRole: true }
          });
          if (!target) throw new AdminActionError(404, "user_not_found", "User not found");
          if (target.id === actor.id) {
            throw new AdminActionError(409, "cannot_suspend_self", "You cannot suspend your own account");
          }
          if (target.platformRole === "SUPER_ADMIN" && actor.platformRole !== "SUPER_ADMIN") {
            throw new AdminActionError(
              403,
              "super_admin_required",
              "Only a Super Admin may modify a Super Admin"
            );
          }
          if (target.status === "suspended") {
            throw new AdminActionError(409, "already_suspended", "Account is already suspended");
          }

          const activeSuperAdminCount = await tx.user.count({
            where: { platformRole: "SUPER_ADMIN", status: "active" }
          });
          if (
            isLastActiveSuperAdmin({
              targetRole: target.platformRole,
              targetStatus: target.status,
              activeSuperAdminCount
            })
          ) {
            throw new AdminActionError(
              409,
              "last_super_admin",
              "The last active Super Admin cannot be suspended"
            );
          }

          const result = await tx.user.update({
            where: { id },
            data: { status: "suspended", sessionVersion: { increment: 1 } },
            select: safeUserSelect
          });

          await recordAudit(
            {
              actorUserId: actor.id,
              actorRole: actor.platformRole,
              action: "user.suspended",
              entityType: "User",
              entityId: id,
              outcome: "success",
              requestId: request.id,
              metadata: { reason: parsed.data.reason, targetEmail: target.email }
            },
            { client: tx, throwOnError: true }
          );

          return result;
        });

        return { user: updated };
      } catch (error) {
        return sendAdminActionError(reply, error);
      }
    }
  );

  app.post(
    `${base}/:id/reactivate`,
    { onRequest: [app.authenticate], preHandler: requirePermission("users.manage") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reactivateSchema.safeParse(request.body ?? {});
      if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

      const actor = getAuthUser(request);
      const db = prisma!;

      try {
        const updated = await db.$transaction(async (tx) => {
          const target = await tx.user.findUnique({
            where: { id },
            select: { id: true, email: true, status: true, platformRole: true }
          });
          if (!target) throw new AdminActionError(404, "user_not_found", "User not found");
          if (target.platformRole === "SUPER_ADMIN" && actor.platformRole !== "SUPER_ADMIN") {
            throw new AdminActionError(
              403,
              "super_admin_required",
              "Only a Super Admin may modify a Super Admin"
            );
          }
          if (target.status === "active") {
            throw new AdminActionError(409, "already_active", "Account is already active");
          }

          const result = await tx.user.update({
            where: { id },
            data: { status: "active", sessionVersion: { increment: 1 } },
            select: safeUserSelect
          });

          await recordAudit(
            {
              actorUserId: actor.id,
              actorRole: actor.platformRole,
              action: "user.reactivated",
              entityType: "User",
              entityId: id,
              outcome: "success",
              requestId: request.id,
              metadata: { reason: parsed.data.reason, targetEmail: target.email }
            },
            { client: tx, throwOnError: true }
          );

          return result;
        });

        return { user: updated };
      } catch (error) {
        return sendAdminActionError(reply, error);
      }
    }
  );

  /**
   * Platform-role assignment is Super-Admin-only (`users.roles`).
   * Organization roles are managed by the organization itself and are not
   * touched here.
   */
  app.put(
    `${base}/:id/platform-role`,
    { onRequest: [app.authenticate], preHandler: requirePermission("users.roles") },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = roleChangeSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

      const actor = getAuthUser(request);
      const nextRole = parsed.data.role as PlatformRole | null;

      if (targetIsSelf(actor.id, id)) {
        return sendError(reply, 409, "cannot_change_own_role", "You cannot change your own platform role");
      }

      const db = prisma!;

      try {
        const updated = await db.$transaction(async (tx) => {
          await lockSuperAdminInvariant(tx);

          const target = await tx.user.findUnique({
            where: { id },
            select: { id: true, email: true, status: true, platformRole: true }
          });
          if (!target) throw new AdminActionError(404, "user_not_found", "User not found");

          if (target.platformRole === nextRole) {
            throw new AdminActionError(409, "role_unchanged", "The user already holds this platform role");
          }

          const removingSuperAdmin = target.platformRole === "SUPER_ADMIN" && nextRole !== "SUPER_ADMIN";
          if (removingSuperAdmin && target.status === "active") {
            const activeSuperAdminCount = await tx.user.count({
              where: { platformRole: "SUPER_ADMIN", status: "active" }
            });
            if (
              isLastActiveSuperAdmin({
                targetRole: target.platformRole,
                targetStatus: target.status,
                activeSuperAdminCount
              })
            ) {
              throw new AdminActionError(
                409,
                "last_super_admin",
                "The last active Super Admin cannot be demoted"
              );
            }
          }

          const result = await tx.user.update({
            where: { id },
            data: { platformRole: nextRole, sessionVersion: { increment: 1 } },
            select: safeUserSelect
          });

          await recordAudit(
            {
              actorUserId: actor.id,
              actorRole: actor.platformRole,
              action: "user.platform_role.changed",
              entityType: "User",
              entityId: id,
              outcome: "success",
              requestId: request.id,
              metadata: {
                from: target.platformRole,
                to: nextRole,
                reason: parsed.data.reason,
                targetEmail: target.email
              }
            },
            { client: tx, throwOnError: true }
          );

          return result;
        });

        return { user: updated };
      } catch (error) {
        return sendAdminActionError(reply, error);
      }
    }
  );

  /** Role catalogue for the assignment dialog; not a mutation. */
  app.get(
    "/api/v1/admin/platform-roles",
    { onRequest: [app.authenticate], preHandler: requirePermission("users.read") },
    async () => ({ roles: PLATFORM_ROLES })
  );
}

function targetIsSelf(actorId: string, targetId: string): boolean {
  return actorId === targetId;
}

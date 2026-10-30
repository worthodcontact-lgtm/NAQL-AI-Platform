import { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { recordAudit } from "../audit/log.js";
import {
  COMPANY_ROLES,
  canAssignCompanyRole,
  companyContext,
  isCompanyOwner,
  normalizeCompanyRole,
  requireCompanyPermission
} from "../auth/company.js";
import { TRADE_ROLES } from "../auth/account.js";

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(COMPANY_ROLES)
});

const roleChangeSchema = z.object({
  role: z.enum(COMPANY_ROLES)
});

const accountClassificationSchema = z.object({
  tradeRole: z.enum(TRADE_ROLES).nullable()
});

function requireDatabase(reply: any) {
  return reply.code(503).send({
    error: "Company member management requires the PostgreSQL persistence layer",
    code: "database_required"
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isOwnerRole(role: string): boolean {
  return normalizeCompanyRole(role) === "COMPANY_OWNER";
}

function isCompanyAdminRole(role: string): boolean {
  const normalized = normalizeCompanyRole(role);
  return normalized === "COMPANY_OWNER" || normalized === "COMPANY_ADMIN";
}

const ROLE_PRIORITY: Record<string, number> = {
  COMPANY_OWNER: 0,
  COMPANY_ADMIN: 1,
  OPERATIONS_MANAGER: 2,
  LOGISTICS_OPERATOR: 3,
  FINANCE_USER: 4,
  DOCUMENTS_USER: 5,
  VIEWER: 6
};

function rolePriority(role: string): number {
  const normalized = normalizeCompanyRole(role);
  return normalized ? ROLE_PRIORITY[normalized] ?? 99 : 99;
}

function normalizedRoles(rows: Array<{ role: string }>): string[] {
  return [...new Set(rows.map((row) => row.role))];
}

function primaryRole(rows: Array<{ role: string }>): string {
  return [...rows].sort((a, b) => rolePriority(a.role) - rolePriority(b.role))[0]?.role ?? "VIEWER";
}

function memberStatus(rows: Array<{ status: string }>): string {
  if (rows.some((row) => row.status === "active")) return "active";
  if (rows.some((row) => row.status === "invited")) return "invited";
  return "suspended";
}

/** One member is one user, even when legacy data contains several role rows. */
function aggregateMemberships(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = row.userId;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const active = group.find((row) => row.status === "active");
    const invited = group.find((row) => row.status === "invited");
    const chosen = active ?? invited ?? group[0];
    const createdTimes = group.map((row) => new Date(row.createdAt).getTime());
    const updatedTimes = group.map((row) => new Date(row.updatedAt ?? row.createdAt).getTime());
    return {
      id: chosen.id,
      role: primaryRole(group),
      roles: normalizedRoles(group),
      status: memberStatus(group),
      invitedByUserId: chosen.invitedByUserId,
      acceptedAt: active?.acceptedAt ?? chosen.acceptedAt ?? null,
      createdAt: new Date(Math.min(...createdTimes)),
      updatedAt: new Date(Math.max(...updatedTimes)),
      user: chosen.user
    };
  });
}

async function activeOwnerCount(client: any, organizationId: string, excludeUserId?: string) {
  const rows = await client.membership.findMany({
    where: { organizationId, status: "active" },
    select: { userId: true, role: true }
  });
  return new Set(
    rows
      .filter((row: any) => isOwnerRole(row.role) && row.userId !== excludeUserId)
      .map((row: any) => row.userId)
  ).size;
}

/**
 * Membership changes for one organization are serialized with a transaction
 * advisory lock. Without it, two owners could remove each other concurrently
 * and leave the organization with no owner.
 */
async function withOrganizationLock<T>(organizationId: string, work: (tx: any) => Promise<T>): Promise<T> {
  return prisma!.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId})::bigint)`;
    return work(tx);
  });
}

export async function registerCompanyWorkspaceRoutes(app: FastifyInstance) {
  /** The caller's workspace context: organization, explicit roles, permissions. */
  app.get(
    "/api/v1/company",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.settings.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const organization = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          accountType: true,
          tradeRole: true,
          createdAt: true
        }
      });
      return {
        organization,
        context: companyContext(user)
      };
    }
  );

  /**
   * Update only the organization's own importer/exporter classification.
   * Account type is not client-writable here: becoming a provider requires an
   * explicit provider Company profile, and platform roles have no such route.
   */
  app.patch(
    "/api/v1/company/account",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.settings.manage") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const parsed = accountClassificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      }

      const updated = await prisma.organization.update({
        where: { id: user.organizationId },
        data: { tradeRole: parsed.data.tradeRole },
        select: {
          id: true,
          name: true,
          slug: true,
          accountType: true,
          tradeRole: true
        }
      });

      await recordAudit({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "organization.trade_role.update",
        entityType: "Organization",
        entityId: user.organizationId,
        outcome: "success",
        requestId: request.id,
        metadata: { tradeRole: updated.tradeRole }
      });

      return {
        organization: updated,
        context: { ...companyContext(user), tradeRole: updated.tradeRole }
      };
    }
  );

  app.get(
    "/api/v1/company/members",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.read") },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const rows = await prisma.membership.findMany({
        where: { organizationId: user.organizationId, status: { in: ["active", "invited", "suspended"] } },
        select: {
          id: true,
          organizationId: true,
          userId: true,
          role: true,
          status: true,
          invitedByUserId: true,
          acceptedAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true, displayName: true, status: true, lastLoginAt: true } }
        },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }]
      });
      return { items: aggregateMemberships(rows) };
    }
  );

  /**
   * Invite a member by email.
   *
   * Existing accounts receive an in-app membership invitation. A new address
   * receives a one-time token that must be supplied at registration; the raw
   * token is returned exactly once and never stored.
   */
  app.post(
    "/api/v1/company/members/invite",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.manage") },
    async (request, reply) => {
      const actor = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const parsed = invitationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      if (!canAssignCompanyRole(actor.roles, parsed.data.role)) {
        return reply.code(403).send({
          error: "You cannot grant that company role",
          code: "role_not_assignable"
        });
      }

      const email = parsed.data.email.trim().toLowerCase();
      if (email === actor.email.toLowerCase()) {
        return reply.code(409).send({ error: "You already belong to this workspace", code: "already_member" });
      }

      const outcome = await withOrganizationLock(actor.organizationId, async (tx) => {
        const target = await tx.user.findUnique({ where: { email } });

        if (target) {
          const existing = await tx.membership.findMany({
            where: { organizationId: actor.organizationId, userId: target.id }
          });
          if (existing.some((row: any) => row.status === "active")) {
            return { error: { status: 409, code: "already_member", error: "User is already a member" } };
          }

          // Legacy data may contain several role rows for one user. Keep one
          // row, replace its role, and remove every other active role so an
          // invitation cannot leave an old privilege behind.
          const keep = existing.find((row: any) => row.role === parsed.data.role) ?? existing[0];
          let invitation: any;
          if (keep) {
            await tx.membership.deleteMany({
              where: {
                organizationId: actor.organizationId,
                userId: target.id,
                id: { not: keep.id }
              }
            });
            const updated = await tx.membership.update({
              where: { id: keep.id },
              data: {
                role: parsed.data.role,
                status: "invited",
                invitedByUserId: actor.id,
                acceptedAt: null
              }
            });
            invitation = {
              kind: "membership",
              ...updated,
              user: { id: target.id, email: target.email, displayName: target.displayName }
            };
          } else {
            const created = await tx.membership.create({
              data: {
                organizationId: actor.organizationId,
                userId: target.id,
                role: parsed.data.role,
                status: "invited",
                invitedByUserId: actor.id
              }
            });
            invitation = {
              kind: "membership",
              ...created,
              user: { id: target.id, email: target.email, displayName: target.displayName }
            };
          }
          return { invitation, targetUserId: target.id };
        }

        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 7 * 86_400_000);
        await tx.companyInvitation.updateMany({
          where: { organizationId: actor.organizationId, email, status: "pending" },
          data: { status: "revoked" }
        });
        const created = await tx.companyInvitation.create({
          data: {
            organizationId: actor.organizationId,
            email,
            role: parsed.data.role,
            tokenHash: hashToken(token),
            status: "pending",
            invitedByUserId: actor.id,
            expiresAt
          }
        });
        return {
          invitation: {
            kind: "email",
            id: created.id,
            email: created.email,
            role: created.role,
            status: created.status,
            expiresAt: created.expiresAt,
            token
          },
          targetUserId: null
        };
      });

      if ("error" in outcome && outcome.error) {
        return reply.code(outcome.error.status).send({
          error: outcome.error.error,
          code: outcome.error.code
        });
      }
      const invitation = outcome.invitation;
      if (!invitation) throw new Error("Invitation was not created");

      await recordAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: "company.member.invited",
        entityType: "Membership",
        entityId: invitation.id,
        outcome: "success",
        requestId: request.id,
        metadata: { email, role: parsed.data.role, kind: invitation.kind }
      });

      return { invitation };
    }
  );

  app.patch(
    "/api/v1/company/members/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.manage") },
    async (request, reply) => {
      const actor = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const { id } = request.params as { id: string };
      const parsed = roleChangeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

      if (!canAssignCompanyRole(actor.roles, parsed.data.role)) {
        return reply.code(403).send({ error: "You cannot grant that company role", code: "role_not_assignable" });
      }

      const outcome = await withOrganizationLock(actor.organizationId, async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id, organizationId: actor.organizationId },
          include: { user: { select: { id: true, email: true, organizationId: true } } }
        });
        if (!membership) {
          return { error: { status: 404, code: "membership_not_found", error: "Membership not found" } };
        }
        if (membership.userId === actor.id) {
          return { error: { status: 409, code: "cannot_change_own_role", error: "You cannot change your own role" } };
        }

        const rows = await tx.membership.findMany({
          where: { organizationId: actor.organizationId, userId: membership.userId },
          select: { id: true, role: true, status: true }
        });
        const previousRoles = normalizedRoles(rows);
        const targetIsAdmin = rows.some((row: any) => isCompanyAdminRole(row.role));
        if (!isCompanyOwner(actor) && targetIsAdmin) {
          return { error: { status: 403, code: "owner_required", error: "Only an owner may modify an owner or admin" } };
        }

        const targetHasOwner = rows.some((row: any) => isOwnerRole(row.role));
        if (targetHasOwner && parsed.data.role !== "COMPANY_OWNER") {
          if ((await activeOwnerCount(tx, actor.organizationId, membership.userId)) === 0) {
            return { error: { status: 409, code: "last_owner", error: "The last owner cannot be demoted" } };
          }
        }

        if (
          rows.length === 1 &&
          normalizeCompanyRole(rows[0].role) === parsed.data.role
        ) {
          return { error: { status: 409, code: "role_unchanged", error: "Role is unchanged" } };
        }

        // A role change is a replacement of the member's complete role set, not
        // an edit of one row. This removes legacy secondary roles atomically so
        // they cannot remain effective after the change.
        await tx.membership.deleteMany({
          where: {
            organizationId: actor.organizationId,
            userId: membership.userId,
            id: { not: membership.id }
          }
        });
        const updated = await tx.membership.update({
          where: { id: membership.id },
          data: { role: parsed.data.role }
        });

        if (membership.user.organizationId === actor.organizationId) {
          await tx.user.update({
            where: { id: membership.userId },
            data: { sessionVersion: { increment: 1 } }
          });
        }

        return {
          membership: updated,
          targetUserId: membership.userId,
          previousRole: primaryRole(rows),
          previousRoles
        };
      });

      if ("error" in outcome && outcome.error) {
        return reply.code(outcome.error.status).send({
          error: outcome.error.error,
          code: outcome.error.code
        });
      }
      if (!outcome.membership) throw new Error("Membership was not updated");

      await recordAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: "company.member.role_changed",
        entityType: "Membership",
        entityId: outcome.membership.id,
        outcome: "success",
        requestId: request.id,
        metadata: {
          targetUserId: outcome.targetUserId,
          from: outcome.previousRoles,
          to: parsed.data.role
        }
      });

      return { membership: outcome.membership, roles: [outcome.membership.role] };
    }
  );

  app.delete(
    "/api/v1/company/members/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.manage") },
    async (request, reply) => {
      const actor = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const { id } = request.params as { id: string };

      const outcome = await withOrganizationLock(actor.organizationId, async (tx) => {
        const membership = await tx.membership.findFirst({
          where: { id, organizationId: actor.organizationId },
          include: { user: { select: { id: true, email: true, organizationId: true } } }
        });
        if (!membership) {
          return { error: { status: 404, code: "membership_not_found", error: "Membership not found" } };
        }
        if (membership.userId === actor.id) {
          return { error: { status: 409, code: "cannot_remove_self", error: "You cannot remove your own membership" } };
        }

        const rows = await tx.membership.findMany({
          where: { organizationId: actor.organizationId, userId: membership.userId },
          select: { id: true, role: true, status: true }
        });
        const previousRoles = normalizedRoles(rows);
        const targetIsAdmin = rows.some((row: any) => isCompanyAdminRole(row.role));
        if (!isCompanyOwner(actor) && targetIsAdmin) {
          return { error: { status: 403, code: "owner_required", error: "Only an owner may remove an owner or admin" } };
        }

        const targetHasOwner = rows.some((row: any) => isOwnerRole(row.role));
        if (targetHasOwner) {
          if ((await activeOwnerCount(tx, actor.organizationId, membership.userId)) === 0) {
            return { error: { status: 409, code: "last_owner", error: "The last owner cannot be removed" } };
          }
        }

        // Delete every role row for this user in this organization. The caller
        // may have addressed one role row from legacy multi-role data; leaving
        // any sibling row would keep the removed member's authority alive.
        const deleted = await tx.membership.deleteMany({
          where: { organizationId: actor.organizationId, userId: membership.userId }
        });

        // If this was the user's primary workspace, move them to another active
        // membership or leave the account without a workspace. Nothing from the
        // removed workspace remains reachable because the principal is rebuilt
        // from the database on every request.
        if (membership.user.organizationId === actor.organizationId) {
          const next = await tx.membership.findFirst({
            where: { userId: membership.userId, status: "active" },
            orderBy: { createdAt: "asc" }
          });
          await tx.user.update({
            where: { id: membership.userId },
            data: {
              organizationId: next?.organizationId ?? null,
              sessionVersion: { increment: 1 }
            }
          });
        }

        return {
          deletedCount: deleted.count,
          targetUserId: membership.userId,
          previousRole: primaryRole(rows),
          previousRoles,
          membershipId: membership.id
        };
      });

      if ("error" in outcome && outcome.error) {
        return reply.code(outcome.error.status).send({
          error: outcome.error.error,
          code: outcome.error.code
        });
      }

      await recordAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: "company.member.removed",
        entityType: "Membership",
        entityId: outcome.membershipId,
        outcome: "success",
        requestId: request.id,
        metadata: {
          targetUserId: outcome.targetUserId,
          roles: outcome.previousRoles,
          removedRows: outcome.deletedCount
        }
      });

      return { removed: true, removedRoles: outcome.deletedCount };
    }
  );

  /** Pending invitations visible to workspace managers. */
  app.get(
    "/api/v1/company/invitations/pending",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.read") },
    async (request, reply) => {
      const actor = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const [memberships, emailInvitations] = await Promise.all([
        prisma.membership.findMany({
          where: { organizationId: actor.organizationId, status: "invited" },
          select: {
            id: true,
            role: true,
            invitedByUserId: true,
            createdAt: true,
            user: { select: { id: true, email: true, displayName: true } }
          }
        }),
        prisma.companyInvitation.findMany({
          where: { organizationId: actor.organizationId, status: "pending" },
          select: { id: true, email: true, role: true, expiresAt: true, createdAt: true }
        })
      ]);
      return { memberships, emailInvitations };
    }
  );

  app.delete(
    "/api/v1/company/invitations/:id",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("company.members.manage") },
    async (request, reply) => {
      const actor = getAuthUser(request);
      if (!prisma) return requireDatabase(reply);
      const { id } = request.params as { id: string };
      const invitation = await prisma.companyInvitation.findFirst({
        where: { id, organizationId: actor.organizationId, status: "pending" }
      });
      if (!invitation) return reply.code(404).send({ error: "Invitation not found", code: "invitation_not_found" });

      await prisma.companyInvitation.update({
        where: { id },
        data: { status: "revoked" }
      });
      await recordAudit({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        action: "company.invitation.revoked",
        entityType: "CompanyInvitation",
        entityId: id,
        outcome: "success",
        requestId: request.id,
        metadata: { email: invitation.email, role: invitation.role }
      });
      return { revoked: true };
    }
  );
}

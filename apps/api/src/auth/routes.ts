import { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../config/env.js";
import { recordAudit } from "../audit/log.js";
import { loadPrincipal, Principal } from "./principal.js";
import { isPlatformRole, permissionsFor, PlatformRole } from "./permissions.js";
import {
  normalizeOrganizationAccountType,
  normalizeTradeRole,
  OrganizationAccountType,
  TradeRole
} from "./account.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  organizationName: z.string().min(2).optional(),
  /**
   * Kept as a string on purpose. Unknown/privilege-looking values are ignored
   * and classified as a customer; only `provider` (or the legacy `company`
   * synonym) selects a provider organization.
   */
  accountType: z.string().trim().max(40).optional(),
  tradeRole: z.enum(["importer", "exporter", "both"]).optional(),
  /** One-time token for an email invitation created before the account existed. */
  invitationToken: z.string().min(20).optional()
});

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Accepting an invitation replaces the user's complete role set in that
 * organization with exactly the invited role. Legacy multi-role rows are
 * removed in the same transaction, so an old role cannot survive acceptance.
 */
async function setSingleMembership(
  tx: any,
  params: {
    organizationId: string;
    userId: string;
    role: string;
    keepId?: string;
    invitedByUserId?: string | null;
    acceptedAt?: Date;
  }
) {
  const rows = await tx.membership.findMany({
    where: { organizationId: params.organizationId, userId: params.userId }
  });
  const keep =
    (params.keepId ? rows.find((row: any) => row.id === params.keepId) : undefined) ??
    rows.find((row: any) => row.role === params.role) ??
    rows[0];

  if (keep) {
    await tx.membership.deleteMany({
      where: {
        organizationId: params.organizationId,
        userId: params.userId,
        id: { not: keep.id }
      }
    });
    return tx.membership.update({
      where: { id: keep.id },
      data: {
        role: params.role,
        status: "active",
        invitedByUserId: params.invitedByUserId ?? keep.invitedByUserId,
        acceptedAt: params.acceptedAt ?? new Date()
      }
    });
  }

  return tx.membership.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
      status: "active",
      invitedByUserId: params.invitedByUserId ?? null,
      acceptedAt: params.acceptedAt ?? new Date()
    }
  });
}

/**
 * Valid bcrypt hashes used only to keep the failed-login code path roughly
 * constant-time when the email does not exist. They do not belong to any user.
 * The administration hash uses the same cost (12) as CLI-provisioned admins.
 */
const DUMMY_PASSWORD_HASH = "$2a$10$UZVG6KgVZjM3780JO8W3aek5omkWOlf9nxwgczXJUozWgLsTKHLlq";
const DUMMY_ADMIN_PASSWORD_HASH = "$2a$12$ldIB5YWJOA8IYnp7juQv/.13D3.JfyiDtisF6VX/x3tHvpzmBb5aG";

type DevUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  organizationId: string;
  roles: string[];
  accountType: OrganizationAccountType;
  tradeRole: TradeRole | null;
};

/** In-memory fallback users. They can never hold a platform role. */
const devUsers = new Map<string, DevUser>();

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  organizationId: string;
  /** Organization-membership roles only. */
  roles: string[];
  /** Customer/provider classification of the current organization. */
  accountType: OrganizationAccountType;
  /** importer | exporter | both | null for the current organization. */
  tradeRole: TradeRole | null;
  /** Platform authority, independent of any organization membership. */
  platformRole: PlatformRole | null;
  /** `admin` only for tokens issued by the administration login endpoint. */
  scope: "app" | "admin";
  status: "active" | "suspended";
}

export function getAuthUser(request: FastifyRequest): AuthUser {
  const raw = request.user as any;
  return {
    id: String(raw?.sub ?? raw?.id ?? ""),
    email: String(raw?.email ?? ""),
    displayName: raw?.displayName,
    organizationId: String(raw?.organizationId ?? ""),
    roles: Array.isArray(raw?.roles) ? raw.roles.map(String) : [],
    accountType: normalizeOrganizationAccountType(raw?.accountType),
    tradeRole: normalizeTradeRole(raw?.tradeRole),
    platformRole: isPlatformRole(raw?.platformRole) ? raw.platformRole : null,
    scope: raw?.scope === "admin" ? "admin" : "app",
    status: raw?.status === "suspended" ? "suspended" : "active"
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "organization";
}

const APP_TOKEN_OPTIONS = { expiresIn: env.JWT_EXPIRES_IN } as const;
const ADMIN_TOKEN_OPTIONS = { expiresIn: env.ADMIN_JWT_EXPIRES_IN } as const;

function tokenPayload(principal: Principal, scope: "app" | "admin") {
  return {
    sub: principal.id,
    email: principal.email,
    displayName: principal.displayName,
    organizationId: principal.organizationId,
    roles: principal.roles,
    accountType: principal.accountType,
    tradeRole: principal.tradeRole,
    platformRole: principal.platformRole,
    status: principal.status,
    sv: principal.sessionVersion,
    scope
  };
}

function publicUser(principal: Principal) {
  return {
    id: principal.id,
    email: principal.email,
    displayName: principal.displayName,
    organizationId: principal.organizationId,
    roles: principal.roles,
    accountType: principal.accountType,
    tradeRole: principal.tradeRole,
    platformRole: principal.platformRole,
    status: principal.status
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const { email, password, displayName, organizationName } = parsed.data;
      // Accepted values are persisted; unknown hints are treated as a customer
      // account and can never grant platform or provider authority on their own.
      const requestedAccountType = normalizeOrganizationAccountType(parsed.data.accountType);
      const requestedTradeRole = normalizeTradeRole(parsed.data.tradeRole);

      if (prisma) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return reply.code(409).send({ error: "User already exists" });

        // An email invitation is only redeemable by the address it was issued to.
        const invitation = parsed.data.invitationToken
          ? await prisma.companyInvitation.findUnique({
              where: { tokenHash: hashInvitationToken(parsed.data.invitationToken) }
            })
          : null;
        if (parsed.data.invitationToken && !invitation) {
          return reply.code(400).send({ error: "Invalid invitation", code: "invalid_invitation" });
        }
        if (invitation) {
          if (invitation.status !== "pending" || invitation.expiresAt.getTime() < Date.now()) {
            return reply.code(409).send({ error: "Invitation is no longer valid", code: "invitation_expired" });
          }
          if (invitation.email.toLowerCase() !== email.toLowerCase()) {
            return reply.code(403).send({ error: "Invitation email does not match", code: "invitation_email_mismatch" });
          }
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.$transaction(async (tx) => {
          const organizationId = invitation
            ? invitation.organizationId
            : (
                await tx.organization.create({
                  data: {
                    name: organizationName ?? `${displayName}'s Organization`,
                    slug: `${slugify(organizationName ?? displayName)}-${Date.now()}`,
                    // Invitations never alter the destination organization's
                    // classification. New organizations store the explicit
                    // registration intent.
                    accountType: requestedAccountType,
                    tradeRole: requestedTradeRole
                  }
                })
              ).id;

          const created = await tx.user.create({
            data: { email, passwordHash, displayName, organizationId }
          });

          // Registration never grants a platform role. Only a company role.
          await tx.membership.create({
            data: {
              organizationId,
              userId: created.id,
              role: invitation ? invitation.role : "COMPANY_OWNER",
              status: "active",
              invitedByUserId: invitation?.invitedByUserId ?? null,
              acceptedAt: invitation ? new Date() : null
            }
          });

          if (invitation) {
            const claimed = await tx.companyInvitation.updateMany({
              where: { id: invitation.id, status: "pending" },
              data: { status: "accepted", acceptedAt: new Date(), acceptedByUserId: created.id }
            });
            if (claimed.count !== 1) {
              throw new Error("Invitation was already used");
            }
          }

          return created;
        });

        const principal = await loadPrincipal(user.id);
        if (!principal) return reply.code(500).send({ error: "Registration failed" });
        const token = app.jwt.sign(tokenPayload(principal, "app"), APP_TOKEN_OPTIONS);
        return { token, user: publicUser(principal) };
      }

      if (devUsers.has(email)) return reply.code(409).send({ error: "User already exists" });
      const orgId = `dev-org-${devUsers.size + 1}`;
      const passwordHash = await bcrypt.hash(password, 10);
      const user: DevUser = {
        id: `dev-user-${devUsers.size + 1}`,
        email,
        passwordHash,
        displayName,
        organizationId: orgId,
        roles: ["COMPANY_OWNER"],
        accountType: requestedAccountType,
        tradeRole: requestedTradeRole
      };
      devUsers.set(email, user);
      const token = app.jwt.sign(
        {
          sub: user.id,
          email: user.email,
          displayName: user.displayName,
          organizationId: user.organizationId,
          roles: user.roles,
          accountType: user.accountType,
          tradeRole: user.tradeRole,
          platformRole: null,
          status: "active",
          sv: 0,
          scope: "app",
          dev: true
        },
        APP_TOKEN_OPTIONS
      );
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          organizationId: user.organizationId,
          roles: user.roles,
          accountType: user.accountType,
          tradeRole: user.tradeRole,
          platformRole: null,
          status: "active"
        },
        devFallback: true
      };
    }
  );

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const { email, password } = parsed.data;

      if (prisma) {
        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user || !ok) return reply.code(401).send({ error: "Invalid credentials", code: "invalid_credentials" });
        if (user.status === "suspended") {
          return reply.code(403).send({ error: "Account suspended", code: "account_suspended" });
        }

        let organizationId = user.organizationId;
        if (!organizationId) {
          // A removed member may still hold another active workspace. Re-enter
          // that workspace instead of silently creating a new one.
          const existingMembership = await prisma.membership.findFirst({
            where: { userId: user.id, status: "active" },
            orderBy: { createdAt: "asc" }
          });
          if (existingMembership) {
            organizationId = existingMembership.organizationId;
            await prisma.user.update({ where: { id: user.id }, data: { organizationId } });
          } else {
            const org = await prisma.organization.create({
              data: { name: `${user.displayName}'s Organization`, slug: `org-${Date.now()}` }
            });
            await prisma.user.update({ where: { id: user.id }, data: { organizationId: org.id } });
            await prisma.membership.create({
              data: { organizationId: org.id, userId: user.id, role: "COMPANY_OWNER", status: "active" }
            });
            organizationId = org.id;
          }
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        const principal = await loadPrincipal(user.id);
        if (!principal) return reply.code(401).send({ error: "Invalid credentials", code: "invalid_credentials" });
        const token = app.jwt.sign(tokenPayload(principal, "app"), APP_TOKEN_OPTIONS);
        return { token, user: publicUser(principal) };
      }

      const user = devUsers.get(email);
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !ok) return reply.code(401).send({ error: "Invalid credentials", code: "invalid_credentials" });
      const token = app.jwt.sign(
        {
          sub: user.id,
          email: user.email,
          displayName: user.displayName,
          organizationId: user.organizationId,
          roles: user.roles,
          accountType: user.accountType,
          tradeRole: user.tradeRole,
          platformRole: null,
          status: "active",
          sv: 0,
          scope: "app",
          dev: true
        },
        APP_TOKEN_OPTIONS
      );
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          organizationId: user.organizationId,
          roles: user.roles,
          accountType: user.accountType,
          tradeRole: user.tradeRole,
          platformRole: null,
          status: "active"
        },
        devFallback: true
      };
    }
  );

  app.get("/api/v1/auth/me", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    return { user: { ...user, permissions: user.scope === "admin" ? permissionsFor(user.platformRole) : [] } };
  });

  /**
   * Workspace list for the signed-in account. Invitations are listed separately
   * and never appear as active memberships until accepted.
   */
  app.get("/api/v1/auth/organizations", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope !== "app") {
      return reply.code(403).send({ error: "Company workspace session required", code: "company_session_required" });
    }
    if (!prisma) return reply.code(503).send({ error: "Company workspaces require the database", code: "database_required" });

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, status: { in: ["active", "invited"] } },
      select: {
        id: true,
        role: true,
        status: true,
        organizationId: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            accountType: true,
            tradeRole: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    return {
      currentOrganizationId: user.organizationId,
      items: memberships
    };
  });

  /**
   * Explicit context switch. The new token is scoped to the selected
   * organization, and the previous token is revoked by bumping sessionVersion so
   * data from the previous workspace cannot leak into the new one.
   */
  app.post("/api/v1/auth/switch-organization", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope !== "app") {
      return reply.code(403).send({ error: "Company workspace session required", code: "company_session_required" });
    }
    if (!prisma) return reply.code(503).send({ error: "Company workspaces require the database", code: "database_required" });

    const parsed = z.object({ organizationId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const targetOrganizationId = parsed.data.organizationId;

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, organizationId: targetOrganizationId, status: "active" },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, accountType: true, tradeRole: true }
        }
      }
    });
    if (!membership) {
      return reply.code(403).send({ error: "No active membership in that workspace", code: "membership_required" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { organizationId: targetOrganizationId, sessionVersion: { increment: 1 } }
    });
    const principal = await loadPrincipal(user.id);
    if (!principal) return reply.code(500).send({ error: "Could not switch workspace", code: "switch_failed" });

    await recordAudit({
      organizationId: targetOrganizationId,
      actorUserId: user.id,
      action: "workspace.switched",
      entityType: "Organization",
      entityId: targetOrganizationId,
      outcome: "success",
      requestId: request.id,
      metadata: { fromOrganizationId: user.organizationId, toOrganizationId: targetOrganizationId }
    });

    const token = app.jwt.sign(tokenPayload(principal, "app"), APP_TOKEN_OPTIONS);
    return { token, user: publicUser(principal), organization: membership.organization };
  });

  /** Pending invitations for the signed-in email. */
  app.get("/api/v1/auth/company-invitations", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope !== "app") {
      return reply.code(403).send({ error: "Company workspace session required", code: "company_session_required" });
    }
    if (!prisma) return reply.code(503).send({ error: "Company workspaces require the database", code: "database_required" });

    const [memberships, emailInvitations] = await Promise.all([
      prisma.membership.findMany({
        where: { userId: user.id, status: "invited" },
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          organization: {
            select: { id: true, name: true, slug: true, accountType: true, tradeRole: true }
          }
        }
      }),
      prisma.companyInvitation.findMany({
        where: { email: user.email.toLowerCase(), status: "pending", expiresAt: { gt: new Date() } },
        select: {
          id: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          organization: {
            select: { id: true, name: true, slug: true, accountType: true, tradeRole: true }
          }
        }
      })
    ]);

    return {
      memberships,
      emailInvitations
    };
  });

  app.post(
    "/api/v1/auth/company-invitations/memberships/:id/accept",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (user.scope !== "app") {
        return reply.code(403).send({ error: "Company workspace session required", code: "company_session_required" });
      }
      if (!prisma) return reply.code(503).send({ error: "Company workspaces require the database", code: "database_required" });

      const { id } = request.params as { id: string };
      const membership = await prisma.membership.findFirst({
        where: { id, userId: user.id, status: "invited" },
        include: { organization: {
            select: { id: true, name: true, slug: true, accountType: true, tradeRole: true }
          } }
      });
      if (!membership) return reply.code(404).send({ error: "Invitation not found", code: "invitation_not_found" });

      const updated = await prisma.$transaction((tx) =>
        setSingleMembership(tx, {
          organizationId: membership.organizationId,
          userId: user.id,
          role: membership.role,
          keepId: membership.id,
          invitedByUserId: membership.invitedByUserId,
          acceptedAt: new Date()
        })
      );

      await recordAudit({
        organizationId: membership.organizationId,
        actorUserId: user.id,
        action: "company.membership.accepted",
        entityType: "Membership",
        entityId: updated.id,
        outcome: "success",
        requestId: request.id,
        metadata: { role: updated.role }
      });

      return {
        membership: { id: updated.id, role: updated.role, status: updated.status },
        organization: membership.organization,
        switchRequired: membership.organizationId !== user.organizationId
      };
    }
  );

  app.post(
    "/api/v1/auth/company-invitations/email/:id/accept",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = getAuthUser(request);
      if (user.scope !== "app") {
        return reply.code(403).send({ error: "Company workspace session required", code: "company_session_required" });
      }
      if (!prisma) return reply.code(503).send({ error: "Company workspaces require the database", code: "database_required" });

      const { id } = request.params as { id: string };
      const invitation = await prisma.companyInvitation.findFirst({
        where: {
          id,
          email: user.email.toLowerCase(),
          status: "pending",
          expiresAt: { gt: new Date() }
        },
        include: { organization: {
            select: { id: true, name: true, slug: true, accountType: true, tradeRole: true }
          } }
      });
      if (!invitation) return reply.code(404).send({ error: "Invitation not found", code: "invitation_not_found" });

      try {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.companyInvitation.updateMany({
            where: { id: invitation.id, status: "pending" },
            data: { status: "accepted", acceptedAt: new Date(), acceptedByUserId: user.id }
          });
          if (claimed.count !== 1) throw new Error("Invitation was already used");

          // Use the role on the current invitation. A suspended membership may
          // still carry an old role (including owner); accepting a new invitation
          // must not silently restore more authority than was offered.
          await setSingleMembership(tx, {
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role,
            invitedByUserId: invitation.invitedByUserId,
            acceptedAt: new Date()
          });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "Invitation was already used") {
          return reply.code(409).send({ error: "Invitation is no longer valid", code: "invitation_expired" });
        }
        throw error;
      }

      await recordAudit({
        organizationId: invitation.organizationId,
        actorUserId: user.id,
        action: "company.invitation.accepted",
        entityType: "CompanyInvitation",
        entityId: invitation.id,
        outcome: "success",
        requestId: request.id,
        metadata: { role: invitation.role }
      });

      return {
        accepted: true,
        organization: invitation.organization,
        switchRequired: invitation.organizationId !== user.organizationId
      };
    }
  );

  /**
   * Administration login. This is a separate entry point from the ordinary
   * login above: it only succeeds for an account that already holds a platform
   * role, and the token it issues carries `scope: "admin"`.
   *
   * No public endpoint can grant the first platform role; see
   * `scripts/admin-cli.ts` for secure server-side provisioning.
   */
  app.post(
    "/api/v1/admin/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!prisma) {
        return reply.code(503).send({
          error: "Administration requires the PostgreSQL persistence layer",
          code: "admin_requires_database"
        });
      }

      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_ADMIN_PASSWORD_HASH);

      if (!user || !ok) {
        // Never reveal whether the address exists. Only confirmed admin
        // authentication failures are recorded with an email address.
        if (user) {
          await recordAudit({
            actorUserId: user.id,
            action: "admin.login.failed",
            entityType: "user",
            entityId: user.id,
            outcome: "failure",
            requestId: request.id,
            metadata: { reason: "invalid_credentials" }
          });
        }
        return reply.code(401).send({ error: "Invalid credentials", code: "invalid_credentials" });
      }

      if (user.status === "suspended") {
        await recordAudit({
          actorUserId: user.id,
          action: "admin.login.denied",
          entityType: "user",
          entityId: user.id,
          outcome: "denied",
          requestId: request.id,
          metadata: { reason: "account_suspended" }
        });
        return reply.code(403).send({ error: "Account suspended", code: "account_suspended" });
      }

      const principal = await loadPrincipal(user.id);
      if (!principal || !principal.platformRole) {
        await recordAudit({
          actorUserId: user.id,
          action: "admin.login.denied",
          entityType: "user",
          entityId: user.id,
          outcome: "denied",
          requestId: request.id,
          metadata: { reason: "not_platform_staff" }
        });
        return reply.code(403).send({
          error: "This account does not hold a platform administration role",
          code: "not_platform_staff"
        });
      }

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      await recordAudit({
        actorUserId: principal.id,
        actorRole: principal.platformRole,
        action: "admin.login.succeeded",
        entityType: "user",
        entityId: principal.id,
        outcome: "success",
        requestId: request.id,
        metadata: { role: principal.platformRole }
      });

      const token = app.jwt.sign(tokenPayload(principal, "admin"), ADMIN_TOKEN_OPTIONS);
      return {
        token,
        user: { ...publicUser(principal), scope: "admin" as const },
        permissions: permissionsFor(principal.platformRole)
      };
    }
  );

  app.get("/api/v1/admin/auth/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope !== "admin") {
      return reply.code(403).send({ error: "Administration session required", code: "admin_session_required" });
    }
    if (!user.platformRole) {
      return reply.code(403).send({ error: "Forbidden", code: "not_platform_staff" });
    }
    return { user, permissions: permissionsFor(user.platformRole) };
  });

  app.post("/api/v1/admin/auth/logout", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (user.scope !== "admin") {
      return reply.code(403).send({ error: "Administration session required", code: "admin_session_required" });
    }
    if (!prisma) {
      return reply.code(503).send({ error: "Administration session store unavailable", code: "admin_requires_database" });
    }

    /**
     * JWTs are stateless, so discarding the browser token alone would leave a
     * stolen copy usable until it expires. Bumping the server-side session
     * version revokes every token issued for this account, not just this tab.
     * This is deliberately an all-session logout; it is documented in
     * docs/platform-admin.md.
     */
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } }
      });
    } catch {
      return reply.code(503).send({ error: "Could not revoke the session", code: "logout_failed" });
    }

    await recordAudit({
      actorUserId: user.id,
      actorRole: user.platformRole,
      action: "admin.logout",
      entityType: "session",
      entityId: user.id,
      outcome: "success",
      requestId: request.id,
      metadata: { revoked: "all_sessions" }
    });
    return reply.code(200).send({ ok: true });
  });
}

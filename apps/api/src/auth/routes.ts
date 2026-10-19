import { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../config/env.js";
import { recordAudit } from "../audit/log.js";
import { loadPrincipal, Principal } from "./principal.js";
import { isPlatformRole, permissionsFor, PlatformRole } from "./permissions.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  organizationName: z.string().min(2).optional()
});

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

      if (prisma) {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return reply.code(409).send({ error: "User already exists" });
        const org = await prisma.organization.create({
          data: {
            name: organizationName ?? `${displayName}'s Organization`,
            slug: `${slugify(organizationName ?? displayName)}-${Date.now()}`
          }
        });
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
          data: { email, passwordHash, displayName, organizationId: org.id }
        });
        // Registration never grants a platform role. Only an organization role.
        await prisma.membership.create({
          data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" }
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
        roles: ["ORG_ADMIN"]
      };
      devUsers.set(email, user);
      const token = app.jwt.sign(
        {
          sub: user.id,
          email: user.email,
          displayName: user.displayName,
          organizationId: user.organizationId,
          roles: user.roles,
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
          const org = await prisma.organization.create({
            data: { name: `${user.displayName}'s Organization`, slug: `org-${Date.now()}` }
          });
          await prisma.user.update({ where: { id: user.id }, data: { organizationId: org.id } });
          await prisma.membership.create({ data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" } });
          organizationId = org.id;
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

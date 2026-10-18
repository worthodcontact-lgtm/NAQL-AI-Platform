import { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  organizationName: z.string().min(2).optional(),
  /**
   * Development-only account hint, accepted ONLY when NODE_ENV !== "production".
   * In production, roles always come from organization membership records.
   */
  accountType: z.enum(["customer", "company", "reviewer", "admin"]).optional()
});

type DevUser = {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  organizationId: string;
  roles: string[];
};

const devUsers = new Map<string, DevUser>();

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  organizationId: string;
  roles: string[];
}

export function getAuthUser(request: FastifyRequest): AuthUser {
  const raw = request.user as any;
  return {
    id: String(raw?.sub ?? raw?.id ?? ""),
    email: String(raw?.email ?? ""),
    displayName: raw?.displayName,
    organizationId: String(raw?.organizationId ?? ""),
    roles: Array.isArray(raw?.roles) ? raw.roles.map(String) : []
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "organization";
}

async function rolesForUser(userId: string, organizationId: string): Promise<string[]> {
  if (!prisma) return [];
  try {
    const memberships = await (prisma as any).membership.findMany({ where: { userId, organizationId } });
    if (memberships.length) return memberships.map((m: any) => String(m.role));
  } catch {
    // ignore
  }
  return [];
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const { email, password, displayName, organizationName } = parsed.data;

    if (prisma) {      const existing = await (prisma as any).user.findUnique({ where: { email } });
      if (existing) return reply.code(409).send({ error: "User already exists" });
      const org = await (prisma as any).organization.create({
        data: { name: organizationName ?? `${displayName}'s Organization`, slug: `${slugify(organizationName ?? displayName)}-${Date.now()}` }
      });
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await (prisma as any).user.create({
        data: { email, passwordHash, displayName, organizationId: org.id }
      });
      await (prisma as any).membership.create({ data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" } });
      const token = app.jwt.sign({ sub: user.id, email: user.email, displayName: user.displayName, organizationId: org.id, roles: ["ORG_ADMIN"], dev: false });
      return { token, user: { id: user.id, email: user.email, displayName: user.displayName, organizationId: org.id, roles: ["ORG_ADMIN"] } };
    }

    if (devUsers.has(email)) return reply.code(409).send({ error: "User already exists" });
    const orgId = `dev-org-${devUsers.size + 1}`;
    const passwordHash = await bcrypt.hash(password, 10);
    // Development-only role hints so local flows (reviewer/admin) can be exercised
    // without a database. An explicit accountType is honored only outside production.
    const hint = process.env.NODE_ENV !== "production" ? parsed.data.accountType : undefined;
    const inferred =
      hint ??
      (email.startsWith("admin")
        ? "admin"
        : email.startsWith("reviewer") || email.startsWith("operator")
          ? "reviewer"
          : "customer");
    const devRoles =
      inferred === "admin"
        ? ["SUPER_ADMIN"]
        : inferred === "reviewer"
          ? ["REVIEWER", "DATA_OPERATOR"]
          : ["ORG_ADMIN"];
    const user: DevUser = { id: `dev-user-${devUsers.size + 1}`, email, passwordHash, displayName, organizationId: orgId, roles: devRoles };
    devUsers.set(email, user);
    const token = app.jwt.sign({ sub: user.id, email: user.email, displayName: user.displayName, organizationId: user.organizationId, roles: user.roles, dev: true });
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, organizationId: user.organizationId, roles: user.roles }, devFallback: true };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const { email, password } = parsed.data;

    if (prisma) {
      const user = await (prisma as any).user.findUnique({ where: { email } });
      if (!user) return reply.code(401).send({ error: "Invalid credentials" });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

      let organizationId = user.organizationId as string | null;
      if (!organizationId) {
        const org = await (prisma as any).organization.create({ data: { name: `${user.displayName}'s Organization`, slug: `org-${Date.now()}` } });
        await (prisma as any).user.update({ where: { id: user.id }, data: { organizationId: org.id } });
        await (prisma as any).membership.create({ data: { organizationId: org.id, userId: user.id, role: "ORG_ADMIN" } });
        organizationId = org.id;
      }
      const roles = await rolesForUser(user.id, organizationId!);
      const safeRoles = roles.length ? roles : ["VIEWER"];
      const token = app.jwt.sign({ sub: user.id, email: user.email, displayName: user.displayName, organizationId, roles: safeRoles, dev: false });
      return { token, user: { id: user.id, email: user.email, displayName: user.displayName, organizationId, roles: safeRoles } };
    }

    const user = devUsers.get(email);
    if (!user) return reply.code(401).send({ error: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });
    const token = app.jwt.sign({ sub: user.id, email: user.email, displayName: user.displayName, organizationId: user.organizationId, roles: user.roles, dev: true });
    return { token, user: { id: user.id, email: user.email, displayName: user.displayName, organizationId: user.organizationId, roles: user.roles }, devFallback: true };
  });

  app.get("/api/v1/auth/me", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    return { user };
  });
}

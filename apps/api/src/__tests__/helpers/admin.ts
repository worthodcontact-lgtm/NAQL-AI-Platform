import bcrypt from "bcryptjs";
import { prisma } from "../../db.js";
import { PlatformRole } from "../../auth/permissions.js";

let counter = 0;

export function adminTestEmail(prefix = "admin-test"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}@naql.test`;
}

export interface CreatedAdmin {
  email: string;
  password: string;
  id: string;
  organizationId: string;
  login: any;
  token: string | null;
}

/**
 * Provisions a platform administrator directly in PostgreSQL.
 *
 * This intentionally bypasses the HTTP API: there is no endpoint that grants a
 * platform role. The public contract is covered by the admin CLI tests and by
 * the negative tests that prove registration cannot elevate an account.
 */
export async function createPlatformAdmin(
  app: any,
  role: PlatformRole,
  options: { password?: string; emailPrefix?: string; status?: "active" | "suspended" } = {}
): Promise<CreatedAdmin> {
  if (!prisma) throw new Error("DATABASE_URL is required for platform administration tests");

  const email = adminTestEmail(options.emailPrefix);
  const password = options.password ?? "admin-password-123";
  const slug = `admin-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const organization = await prisma.organization.create({
    data: { name: "Admin Test Organization", slug }
  });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 4),
      displayName: "Platform Admin",
      organizationId: organization.id,
      platformRole: role,
      status: options.status ?? "active"
    }
  });
  await prisma.membership.create({
    data: { organizationId: organization.id, userId: user.id, role: "ORG_ADMIN" }
  });

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/admin/auth/login",
    payload: { email, password }
  });

  return {
    email,
    password,
    id: user.id,
    organizationId: organization.id,
    login,
    token: login.statusCode === 200 ? JSON.parse(login.payload).token : null
  };
}

/** Removes a test user and its personal organization. Never call on real accounts. */
export async function cleanupPlatformUser(id: string): Promise<void> {
  if (!prisma) return;
  const user = await prisma.user.findUnique({ where: { id }, select: { organizationId: true } });
  if (!user) return;
  await prisma.user.delete({ where: { id } }).catch(() => undefined);
  if (user.organizationId) {
    await prisma.organization.delete({ where: { id: user.organizationId } }).catch(() => undefined);
  }
}

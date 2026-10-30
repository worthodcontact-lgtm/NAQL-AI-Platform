import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { recordAudit, redactAuditValue } from "../audit/log.js";
import { roleHasPermission } from "../auth/permissions.js";
import { isLastActiveSuperAdmin } from "../admin/super-admin.js";
import { cleanupPlatformUser, createPlatformAdmin, CreatedAdmin } from "./helpers/admin.js";

let app: any;
const hasDatabase = Boolean(prisma);
const createdAdminIds: string[] = [];

let superAdmin: CreatedAdmin;
let adminRole: CreatedAdmin;
let reviewer: CreatedAdmin;
let support: CreatedAdmin;

function auth(token: string | null) {
  return { authorization: `Bearer ${token}` };
}

async function registerOrdinary(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@naql.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: "password123", displayName: "Ordinary User" }
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.payload);
  return {
    email,
    password: "password123",
    token: body.token as string,
    id: body.user.id as string,
    organizationId: body.user.organizationId as string
  };
}

async function makeAdmin(role: "SUPER_ADMIN" | "ADMIN" | "REVIEWER" | "SUPPORT", prefix: string) {
  const created = await createPlatformAdmin(app, role, { emailPrefix: prefix });
  createdAdminIds.push(created.id);
  return created;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  if (hasDatabase) {
    superAdmin = await makeAdmin("SUPER_ADMIN", "super");
    adminRole = await makeAdmin("ADMIN", "admin");
    reviewer = await makeAdmin("REVIEWER", "reviewer");
    support = await makeAdmin("SUPPORT", "support");
  }
});

afterAll(async () => {
  for (const id of createdAdminIds) await cleanupPlatformUser(id);
  await app.close();
});

describe.sequential("platform administration security", () => {
  it("rejects anonymous callers on administrative endpoints", async () => {
    const overview = await app.inject({ method: "GET", url: "/api/v1/admin/overview" });
    expect(overview.statusCode).toBe(401);

    const me = await app.inject({ method: "GET", url: "/api/v1/admin/auth/me" });
    expect(me.statusCode).toBe(401);

    const users = await app.inject({ method: "GET", url: "/api/v1/admin/users" });
    expect(users.statusCode).toBe(401);

    const integrations = await app.inject({ method: "GET", url: "/api/v1/admin/integrations" });
    expect(integrations.statusCode).toBe(401);
  });

  it.skipIf(!hasDatabase)("restricts integration diagnostics to platform admins and redacts secrets", async () => {
    const customer = await registerOrdinary("integration-status-customer");
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/admin/integrations",
      headers: auth(customer.token)
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/admin/integrations",
      headers: auth(superAdmin.token)
    });
    expect(allowed.statusCode).toBe(200);
    const body = JSON.parse(allowed.payload);
    expect(body.items.some((item: any) => item.id === "database")).toBe(true);
    expect(body.items.some((item: any) => item.id === "ai")).toBe(true);
    expect(allowed.payload).not.toMatch(/AI_API_KEY|COMTRADE_API_KEY|JWT_SECRET|S3_SECRET_KEY|STORAGE_PATH|Bearer\s+[A-Za-z0-9._-]+/i);
  });

  it.skipIf(!hasDatabase)("denies ordinary customers an administration session", async () => {
    const customer = await registerOrdinary("plain-customer");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: customer.email, password: customer.password }
    });
    expect(login.statusCode).toBe(403);
    expect(JSON.parse(login.payload).code).toBe("not_platform_staff");

    // An ordinary application token can never reach the admin namespace.
    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/admin/overview",
      headers: auth(customer.token)
    });
    expect(overview.statusCode).toBe(403);
    expect(JSON.parse(overview.payload).code).toBe("admin_session_required");
  });

  it.skipIf(!hasDatabase)("does not turn company ownership into platform administration", async () => {
    const owner = await registerOrdinary("company-owner");
    const company = await app.inject({
      method: "POST",
      url: "/api/v1/companies/register",
      headers: auth(owner.token),
      payload: { name: `Owner Co ${Date.now()}`, type: "forwarder", country: "EG", listed: true }
    });
    expect(company.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: owner.email, password: owner.password }
    });
    expect(login.statusCode).toBe(403);
    expect(JSON.parse(login.payload).code).toBe("not_platform_staff");
  });

  it.skipIf(!hasDatabase)("does not turn provider status into platform administration", async () => {
    const provider = await registerOrdinary("listed-provider");
    const company = await app.inject({
      method: "POST",
      url: "/api/v1/companies/register",
      headers: auth(provider.token),
      payload: { name: `Provider Co ${Date.now()}`, type: "shipping", country: "EG", listed: true }
    });
    expect(company.statusCode).toBe(200);
    const directory = await app.inject({ method: "GET", url: "/api/v1/companies/directory" });
    expect(JSON.parse(directory.payload).items.some((item: any) => item.name.startsWith("Provider Co"))).toBe(true);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: provider.email, password: provider.password }
    });
    expect(login.statusCode).toBe(403);
  });

  it.skipIf(!hasDatabase)("requires the separate administration session even for a platform admin", async () => {
    const appLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: superAdmin.email, password: superAdmin.password }
    });
    expect(appLogin.statusCode).toBe(200);
    const appToken = JSON.parse(appLogin.payload).token;

    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(appToken) });
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.payload).user.scope).toBe("app");

    const denied = await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers: auth(appToken) });
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.payload).code).toBe("admin_session_required");

    const adminMe = await app.inject({ method: "GET", url: "/api/v1/admin/auth/me", headers: auth(superAdmin.token) });
    expect(adminMe.statusCode).toBe(200);
    expect(JSON.parse(adminMe.payload).user.scope).toBe("admin");
    expect(JSON.parse(adminMe.payload).permissions).toContain("users.roles");
  });

  it.skipIf(!hasDatabase)("prevents a reviewer from performing Super Admin-only operations", async () => {
    const target = await registerOrdinary("reviewer-target");

    const roleChange = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/users/${target.id}/platform-role`,
      headers: auth(reviewer.token),
      payload: { role: "ADMIN", reason: "privilege escalation attempt" }
    });
    expect(roleChange.statusCode).toBe(403);
    expect(JSON.parse(roleChange.payload).code).toBe("insufficient_permission");

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/suspend`,
      headers: auth(reviewer.token),
      payload: { reason: "not allowed" }
    });
    expect(suspend.statusCode).toBe(403);

    const settings = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings",
      headers: auth(reviewer.token),
      payload: { platformName: "Hijacked" }
    });
    expect(settings.statusCode).toBe(403);

    // The reviewer keeps the permissions that belong to the role.
    const companies = await app.inject({ method: "GET", url: "/api/v1/admin/companies", headers: auth(reviewer.token) });
    expect(companies.statusCode).toBe(200);
    const audit = await app.inject({ method: "GET", url: "/api/v1/admin/audit-logs", headers: auth(reviewer.token) });
    expect(audit.statusCode).toBe(200);
  });

  it.skipIf(!hasDatabase)("prevents an admin from performing explicitly Super Admin-only operations", async () => {
    const target = await registerOrdinary("admin-target");

    const roleChange = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/users/${target.id}/platform-role`,
      headers: auth(adminRole.token),
      payload: { role: "SUPER_ADMIN", reason: "escalation attempt" }
    });
    expect(roleChange.statusCode).toBe(403);
    expect(JSON.parse(roleChange.payload).code).toBe("insufficient_permission");

    const settings = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/settings",
      headers: auth(adminRole.token),
      payload: { platformName: "Hijacked" }
    });
    expect(settings.statusCode).toBe(403);

    // Routine administration remains available.
    const readSettings = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: auth(adminRole.token) });
    expect(readSettings.statusCode).toBe(200);

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/suspend`,
      headers: auth(adminRole.token),
      payload: { reason: "policy violation" }
    });
    expect(suspend.statusCode).toBe(200);
    expect(JSON.parse(suspend.payload).user.status).toBe("suspended");
  });

  it.skipIf(!hasDatabase)("applies least privilege to the support role", async () => {
    const verify = await app.inject({
      method: "POST",
      url: "/api/v1/admin/companies/nonexistent/verify",
      headers: auth(support.token),
      payload: { decision: "approved" }
    });
    // Permission is checked before the resource: 403, not 404.
    expect(verify.statusCode).toBe(403);

    const shipments = await app.inject({ method: "GET", url: "/api/v1/admin/shipments", headers: auth(support.token) });
    expect(shipments.statusCode).toBe(200);
  });

  it.skipIf(!hasDatabase)("blocks self-elevation and self-suspension", async () => {
    const selfRole = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/users/${superAdmin.id}/platform-role`,
      headers: auth(superAdmin.token),
      payload: { role: "ADMIN", reason: "demote self" }
    });
    expect(selfRole.statusCode).toBe(409);
    expect(JSON.parse(selfRole.payload).code).toBe("cannot_change_own_role");

    const selfSuspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${superAdmin.id}/suspend`,
      headers: auth(superAdmin.token),
      payload: { reason: "suspend self" }
    });
    expect(selfSuspend.statusCode).toBe(409);
    expect(JSON.parse(selfSuspend.payload).code).toBe("cannot_suspend_self");
  });

  it.skipIf(!hasDatabase)("invalidates access when an account is suspended and restores it on reactivation", async () => {
    const target = await registerOrdinary("suspend-target");
    const before = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(target.token) });
    expect(before.statusCode).toBe(200);

    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/suspend`,
      headers: auth(superAdmin.token),
      payload: { reason: "security review" }
    });
    expect(suspend.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(target.token) });
    expect(after.statusCode).toBe(403);
    expect(JSON.parse(after.payload).code).toBe("account_suspended");

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: target.email, password: target.password }
    });
    expect(login.statusCode).toBe(403);

    const reactivate = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/reactivate`,
      headers: auth(superAdmin.token),
      payload: { reason: "review complete" }
    });
    expect(reactivate.statusCode).toBe(200);

    const relogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: target.email, password: target.password }
    });
    expect(relogin.statusCode).toBe(200);
  });

  it.skipIf(!hasDatabase)("revokes platform privileges immediately", async () => {
    const temporary = await makeAdmin("ADMIN", "revoked-admin");
    expect(temporary.login.statusCode).toBe(200);

    const before = await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers: auth(temporary.token) });
    expect(before.statusCode).toBe(200);

    const revoke = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/users/${temporary.id}/platform-role`,
      headers: auth(superAdmin.token),
      payload: { role: null, reason: "offboarding" }
    });
    expect(revoke.statusCode).toBe(200);
    expect(JSON.parse(revoke.payload).user.platformRole).toBeNull();

    // The role change bumps sessionVersion, so the old admin token is dead.
    const after = await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers: auth(temporary.token) });
    expect(after.statusCode).toBe(401);
    expect(JSON.parse(after.payload).code).toBe("session_revoked");

    const relogin = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: temporary.email, password: temporary.password }
    });
    expect(relogin.statusCode).toBe(403);
  });

  it.skipIf(!hasDatabase)("prevents lower roles from modifying a Super Admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${superAdmin.id}/suspend`,
      headers: auth(adminRole.token),
      payload: { reason: "attempt" }
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe("super_admin_required");
  });

  it.skipIf(!hasDatabase)("records privileged changes in the audit log with the actor", async () => {
    const target = await registerOrdinary("audit-target");
    const suspend = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${target.id}/suspend`,
      headers: auth(superAdmin.token),
      payload: { reason: "audit check" }
    });
    expect(suspend.statusCode).toBe(200);

    const promoted = await registerOrdinary("audit-promote");
    const roleChange = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/users/${promoted.id}/platform-role`,
      headers: auth(superAdmin.token),
      payload: { role: "REVIEWER", reason: "audit check" }
    });
    expect(roleChange.statusCode).toBe(200);

    const suspendAudit = await app.inject({
      method: "GET",
      url: `/api/v1/admin/audit-logs?action=user.suspended&actorUserId=${superAdmin.id}`,
      headers: auth(superAdmin.token)
    });
    expect(suspendAudit.statusCode).toBe(200);
    const suspendEntry = JSON.parse(suspendAudit.payload).items.find(
      (entry: any) => entry.entityId === target.id
    );
    expect(suspendEntry).toBeTruthy();
    expect(suspendEntry.actorUserId).toBe(superAdmin.id);
    expect(suspendEntry.actorRole).toBe("SUPER_ADMIN");
    expect(suspendEntry.outcome).toBe("success");
    expect(suspendEntry.requestId).toBeTruthy();
    expect(suspendEntry.metadata.reason).toBe("audit check");

    const roleAudit = await app.inject({
      method: "GET",
      url: `/api/v1/admin/audit-logs?action=user.platform_role.changed&actorUserId=${superAdmin.id}`,
      headers: auth(superAdmin.token)
    });
    const roleEntry = JSON.parse(roleAudit.payload).items.find((entry: any) => entry.entityId === promoted.id);
    expect(roleEntry).toBeTruthy();
    expect(roleEntry.metadata.to).toBe("REVIEWER");
  });

  it("redacts credentials from audit metadata", () => {
    const redacted = redactAuditValue({
      password: "super-secret",
      apiKey: "key-123",
      nested: { token: "bearer-xyz", reason: "ok" },
      list: [{ authorization: "Bearer abc" }]
    }) as any;

    expect(redacted.password).toBe("[redacted]");
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.nested.token).toBe("[redacted]");
    expect(redacted.nested.reason).toBe("ok");
    expect(redacted.list[0].authorization).toBe("[redacted]");
  });

  it.skipIf(!hasDatabase)("never returns password hashes or session internals", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/users?q=suspend-target", headers: auth(superAdmin.token) });
    expect(list.statusCode).toBe(200);
    const items = JSON.parse(list.payload).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item).not.toHaveProperty("passwordHash");
      expect(item).not.toHaveProperty("sessionVersion");
      expect(item).not.toHaveProperty("password");
    }

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${items[0].id}`,
      headers: auth(superAdmin.token)
    });
    expect(detail.statusCode).toBe(200);
    const body = JSON.parse(detail.payload);
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.user).not.toHaveProperty("sessionVersion");
    expect(JSON.stringify(body)).not.toContain("$2a$");
    expect(JSON.stringify(body)).not.toContain("$2b$");
  });

  it.skipIf(!hasDatabase)("keeps dashboard metrics consistent with the database", async () => {
    const db = prisma!;
    const [users, organizations, companies, shipments, rfqs, quotes, bookings] = await Promise.all([
      db.user.count(),
      db.organization.count(),
      db.company.count(),
      db.shipment.count(),
      db.rfq.count(),
      db.quote.count(),
      db.bookingRequest.count()
    ]);

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/overview", headers: auth(adminRole.token) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.users.total).toBe(users);
    expect(body.organizations.total).toBe(organizations);
    expect(body.companies.total).toBe(companies);
    expect(body.shipments.total).toBe(shipments);
    expect(body.rfqs.total).toBe(rfqs);
    expect(body.quotes.total).toBe(quotes);
    expect(body.bookings.total).toBe(bookings);
    expect(body.health.database).toBe("connected");
    expect(body.health.persistenceMode).toBe("database");
  });

  it.skipIf(!hasDatabase)("issues expiring administration tokens and rejects legacy no-exp tokens", async () => {
    const decoded = app.jwt.decode(superAdmin.token) as any;
    expect(typeof decoded.exp).toBe("number");
    expect(typeof decoded.iat).toBe("number");
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(6 * 60 * 60);

    // Tokens issued before expiring JWTs were introduced had no `exp` claim and
    // must not remain valid forever.
    const legacy = app.jwt.sign({
      sub: superAdmin.id,
      email: superAdmin.email,
      displayName: "Legacy Admin",
      organizationId: superAdmin.organizationId,
      roles: ["ORG_ADMIN"],
      platformRole: "SUPER_ADMIN",
      status: "active",
      sv: 0,
      scope: "admin"
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: auth(legacy)
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).code).toBe("session_expired");
  });

  it.skipIf(!hasDatabase)("revokes the administration session on logout", async () => {
    const temporary = await makeAdmin("ADMIN", "logout-admin");
    expect(temporary.login.statusCode).toBe(200);

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/logout",
      headers: auth(temporary.token)
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/admin/auth/me",
      headers: auth(temporary.token)
    });
    expect(after.statusCode).toBe(401);
    expect(JSON.parse(after.payload).code).toBe("session_revoked");

    const relogin = await app.inject({
      method: "POST",
      url: "/api/v1/admin/auth/login",
      payload: { email: temporary.email, password: temporary.password }
    });
    expect(relogin.statusCode).toBe(200);
  });

  it.skipIf(!hasDatabase)("includes the whole selected end day in audit and user filters", async () => {
    const action = `test.end-of-day.${Date.now()}`;
    await recordAudit({
      actorUserId: superAdmin.id,
      actorRole: "SUPER_ADMIN",
      action,
      entityType: "Test",
      entityId: "date-filter"
    });

    const today = new Date().toISOString().slice(0, 10);
    const audit = await app.inject({
      method: "GET",
      url: `/api/v1/admin/audit-logs?action=${encodeURIComponent(action)}&to=${today}`,
      headers: auth(superAdmin.token)
    });
    expect(audit.statusCode).toBe(200);
    expect(JSON.parse(audit.payload).total).toBe(1);

    const customer = await registerOrdinary("created-today");
    const users = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users?q=${encodeURIComponent(customer.email)}&createdTo=${today}`,
      headers: auth(superAdmin.token)
    });
    expect(users.statusCode).toBe(200);
    expect(JSON.parse(users.payload).total).toBe(1);
  });

  it.skipIf(!hasDatabase)("does not let an ordinary app token use platform business overrides", async () => {
    const customer = await registerOrdinary("scope-customer");
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/rfqs",
      headers: auth(customer.token),
      payload: {
        origin: "CAI",
        destination: "JED",
        mode: "SEA",
        cargoDescription: "scope boundary test",
        weightKg: 120
      }
    });
    expect(create.statusCode).toBe(200);
    const rfqId = JSON.parse(create.payload).id;

    const appLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: superAdmin.email, password: superAdmin.password }
    });
    expect(appLogin.statusCode).toBe(200);
    const appToken = JSON.parse(appLogin.payload).token;

    const viaAppToken = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfqId}`,
      headers: auth(appToken)
    });
    expect(viaAppToken.statusCode).toBe(403);

    const viaAdminToken = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfqId}`,
      headers: auth(superAdmin.token)
    });
    expect(viaAdminToken.statusCode).toBe(200);
  });

  it.skipIf(!hasDatabase)("hides unlisted companies from the public profile endpoint", async () => {
    const owner = await registerOrdinary("unlisted-owner");
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/companies/register",
      headers: auth(owner.token),
      payload: { name: `Unlisted Co ${Date.now()}`, type: "forwarder", country: "EG", listed: false }
    });
    expect(create.statusCode).toBe(200);
    const companyId = JSON.parse(create.payload).id;

    const publicProfile = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}` });
    expect(publicProfile.statusCode).toBe(404);

    const mine = await app.inject({
      method: "GET",
      url: "/api/v1/companies/mine",
      headers: auth(owner.token)
    });
    expect(mine.statusCode).toBe(200);
    expect(JSON.parse(mine.payload).items.some((item: any) => item.id === companyId)).toBe(true);
  });

  it.skipIf(!hasDatabase)("enforces the documented least-privilege matrix on read endpoints", async () => {
    const supportAudit = await app.inject({ method: "GET", url: "/api/v1/admin/audit-logs", headers: auth(support.token) });
    expect(supportAudit.statusCode).toBe(403);
    const supportReports = await app.inject({ method: "GET", url: "/api/v1/admin/reports", headers: auth(support.token) });
    expect(supportReports.statusCode).toBe(403);
    const supportSettings = await app.inject({ method: "GET", url: "/api/v1/admin/settings", headers: auth(support.token) });
    expect(supportSettings.statusCode).toBe(200);

    const reviewerShipments = await app.inject({ method: "GET", url: "/api/v1/admin/shipments", headers: auth(reviewer.token) });
    expect(reviewerShipments.statusCode).toBe(403);
    const reviewerBookings = await app.inject({ method: "GET", url: "/api/v1/admin/bookings", headers: auth(reviewer.token) });
    expect(reviewerBookings.statusCode).toBe(403);
  });

  it.skipIf(!hasDatabase)("supports clearing optional settings and returns no-store headers", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/v1/admin/settings",
      headers: auth(superAdmin.token)
    });
    expect(before.statusCode).toBe(200);
    const previousSupportEmail = JSON.parse(before.payload).platform.supportEmail;

    try {
      const clear = await app.inject({
        method: "PUT",
        url: "/api/v1/admin/settings",
        headers: auth(superAdmin.token),
        payload: { supportEmail: "" }
      });
      expect(clear.statusCode).toBe(200);

      const settings = await app.inject({
        method: "GET",
        url: "/api/v1/admin/settings",
        headers: auth(superAdmin.token)
      });
      expect(settings.statusCode).toBe(200);
      expect(JSON.parse(settings.payload).platform.supportEmail).toBeNull();
      expect(settings.headers["cache-control"]).toBe("no-store");
      expect(settings.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      if (typeof previousSupportEmail === "string" && previousSupportEmail) {
        await app.inject({
          method: "PUT",
          url: "/api/v1/admin/settings",
          headers: auth(superAdmin.token),
          payload: { supportEmail: previousSupportEmail }
        });
      }
    }
  });

  it.skipIf(!hasDatabase)("rate limits repeated administration login failures", async () => {
    const rateApp = await buildApp();
    await rateApp.ready();
    try {
      const statuses: number[] = [];
      for (let index = 0; index < 21; index += 1) {
        const res = await rateApp.inject({
          method: "POST",
          url: "/api/v1/admin/auth/login",
          payload: { email: superAdmin.email, password: "wrong-password" }
        });
        statuses.push(res.statusCode);
      }
      expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
      expect(statuses[20]).toBe(429);
      const limited = await rateApp.inject({
        method: "POST",
        url: "/api/v1/admin/auth/login",
        payload: { email: "rate-limited@naql.test", password: "wrong-password" }
      });
      expect(limited.statusCode).toBe(429);
      expect(JSON.parse(limited.payload).code).toBe("rate_limited");
    } finally {
      await rateApp.close();
    }
  });

  it.skipIf(!hasDatabase)("blocks ordinary users from reading other accounts through the admin API", async () => {
    const outsider = await registerOrdinary("idor-outsider");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/admin/users/${superAdmin.id}`,
      headers: auth(outsider.token)
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe("admin_session_required");
  });

  it.skipIf(!hasDatabase)("serializes concurrent attempts to remove the last active Super Admins", async () => {
    const first = await makeAdmin("SUPER_ADMIN", "race-first");
    const second = await makeAdmin("SUPER_ADMIN", "race-second");
    const db = prisma!;

    // Temporarily leave exactly two active Super Admins: `first` and `second`.
    // The development database may already contain real administrators, so they
    // are suspended (not deleted or demoted) and restored in `finally`.
    const others = await db.user.findMany({
      where: {
        platformRole: "SUPER_ADMIN",
        status: "active",
        id: { notIn: [first.id, second.id] }
      },
      select: { id: true }
    });
    const otherIds = others.map((user) => user.id);
    if (otherIds.length) {
      await db.user.updateMany({ where: { id: { in: otherIds } }, data: { status: "suspended" } });
    }

    try {
      const [firstAttempt, secondAttempt] = await Promise.all([
        app.inject({
          method: "PUT",
          url: `/api/v1/admin/users/${second.id}/platform-role`,
          headers: auth(first.token),
          payload: { role: "ADMIN", reason: "concurrency check" }
        }),
        app.inject({
          method: "PUT",
          url: `/api/v1/admin/users/${first.id}/platform-role`,
          headers: auth(second.token),
          payload: { role: "ADMIN", reason: "concurrency check" }
        })
      ]);

      const statuses = [firstAttempt.statusCode, secondAttempt.statusCode].sort();
      expect(statuses).toEqual([200, 409]);
      const rejected = [firstAttempt, secondAttempt].find((response) => response.statusCode === 409)!;
      expect(JSON.parse(rejected.payload).code).toBe("last_super_admin");
    } finally {
      if (otherIds.length) {
        await db.user.updateMany({ where: { id: { in: otherIds } }, data: { status: "active" } });
      }
    }
  });

  it("keeps the administration migration additive", () => {
    const sql = fs.readFileSync(
      new URL("../../prisma/migrations/20261019050000_admin_platform_roles/migration.sql", import.meta.url),
      "utf8"
    );
    expect(sql).toMatch(/CREATE TABLE "PlatformSetting"/);
    expect(sql).toMatch(/ADD COLUMN\s+"platformRole"/);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});

describe("permission matrix and Super Admin invariant", () => {
  it("grants Super Admin-only operations only to SUPER_ADMIN", () => {
    expect(roleHasPermission("SUPER_ADMIN", "users.roles")).toBe(true);
    expect(roleHasPermission("SUPER_ADMIN", "settings.manage")).toBe(true);
    expect(roleHasPermission("ADMIN", "users.roles")).toBe(false);
    expect(roleHasPermission("ADMIN", "settings.manage")).toBe(false);
    expect(roleHasPermission("ADMIN", "users.manage")).toBe(true);
    expect(roleHasPermission("REVIEWER", "companies.verify")).toBe(true);
    expect(roleHasPermission("REVIEWER", "users.manage")).toBe(false);
    expect(roleHasPermission("SUPPORT", "shipments.read")).toBe(true);
    expect(roleHasPermission("SUPPORT", "companies.verify")).toBe(false);
    expect(roleHasPermission(null, "admin.access")).toBe(false);
  });

  it("identifies the last active Super Admin", () => {
    expect(isLastActiveSuperAdmin({ targetRole: "SUPER_ADMIN", targetStatus: "active", activeSuperAdminCount: 1 })).toBe(true);
    expect(isLastActiveSuperAdmin({ targetRole: "SUPER_ADMIN", targetStatus: "active", activeSuperAdminCount: 2 })).toBe(false);
    expect(isLastActiveSuperAdmin({ targetRole: "SUPER_ADMIN", targetStatus: "suspended", activeSuperAdminCount: 1 })).toBe(false);
    expect(isLastActiveSuperAdmin({ targetRole: "ADMIN", targetStatus: "active", activeSuperAdminCount: 1 })).toBe(false);
  });
});

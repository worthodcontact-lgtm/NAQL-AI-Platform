import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { cleanupPlatformUser, createPlatformAdmin, CreatedAdmin } from "./helpers/admin.js";

const suite = prisma ? describe : describe.skip;
let app: any;
const stamp = Date.now();
const createdAdminIds: string[] = [];

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function json(res: any) {
  try {
    return JSON.parse(res.payload);
  } catch {
    return null;
  }
}

type Registered = {
  email: string;
  password: string;
  token: string;
  user: any;
};

async function register(
  prefix: string,
  options: {
    accountType?: string;
    tradeRole?: string;
    organizationName?: string;
  } = {}
): Promise<Registered> {
  const email = `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}@naql.test`;
  const password = "Account-separation-password!";
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email,
      password,
      displayName: `${prefix} tester`,
      organizationName: options.organizationName ?? `${prefix} organization ${stamp}`,
      ...(options.accountType ? { accountType: options.accountType } : {}),
      ...(options.tradeRole ? { tradeRole: options.tradeRole } : {})
    }
  });
  expect(response.statusCode).toBe(200);
  const body = await json(response);
  return { email, password, token: body.token, user: body.user };
}

async function login(account: Registered) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: account.email, password: account.password }
  });
  expect(response.statusCode).toBe(200);
  return json(response);
}

async function me(token: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/auth/me",
    headers: auth(token)
  });
  expect(response.statusCode).toBe(200);
  return (await json(response)).user;
}

async function createCompany(
  token: string,
  input: { name: string; type?: string } = { name: `Company ${Math.random()}` }
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/companies/register",
    headers: auth(token),
    payload: {
      name: input.name,
      nameEn: input.name,
      type: input.type ?? "forwarder",
      country: "EG",
      services: [
        {
          mode: input.type === "air" ? "AIR" : "SEA",
          serviceType: "freight",
          originLocation: "Alexandria",
          destinationLocation: "Jeddah",
          shipmentTypes: ["FCL"]
        }
      ]
    }
  });
  expect(response.statusCode).toBe(200);
  return json(response);
}

async function createRfq(token: string, recipientCompanyIds: string[] = []) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/rfqs",
    headers: auth(token),
    payload: {
      origin: "Alexandria",
      destination: "Jeddah",
      mode: "SEA",
      cargoDescription: `Account separation cargo ${Math.random()}`,
      weightKg: 1200,
      recipientCompanyIds
    }
  });
  expect(response.statusCode).toBe(200);
  return json(response);
}

async function switchOrganization(token: string, organizationId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/switch-organization",
    headers: auth(token),
    payload: { organizationId }
  });
  expect(response.statusCode).toBe(200);
  return json(response);
}

suite("account-type separation", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const id of createdAdminIds) await cleanupPlatformUser(id);
  });

  it("persists importer-only, exporter-only and combined trade intent across login", async () => {
    for (const tradeRole of ["importer", "exporter", "both"] as const) {
      const account = await register(`trade-${tradeRole}`, {
        accountType: "customer",
        tradeRole
      });

      expect(account.user.accountType).toBe("customer");
      expect(account.user.tradeRole).toBe(tradeRole);
      expect(account.user.roles).toEqual(["COMPANY_OWNER"]);
      expect(account.user.platformRole).toBeNull();

      const loggedIn = await login(account);
      expect(loggedIn.user.accountType).toBe("customer");
      expect(loggedIn.user.tradeRole).toBe(tradeRole);

      const current = await me(account.token);
      expect(current.accountType).toBe("customer");
      expect(current.tradeRole).toBe(tradeRole);

      // All three intents use the same customer RFQ flow; no duplicate roles or
      // divergent shipment permissions are invented.
      const rfq = await createRfq(account.token);
      expect(rfq.id).toBeTruthy();
    }
  });

  it("lets an existing customer classify or change its trade role without changing account type", async () => {
    const account = await register("trade-update", {
      accountType: "customer",
      tradeRole: "importer"
    });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/company/account",
      headers: auth(account.token),
      // A client cannot smuggle an account-type elevation through this route.
      payload: { tradeRole: "both", accountType: "provider" }
    });
    expect(response.statusCode).toBe(200);
    const body = await json(response);
    expect(body.organization.accountType).toBe("customer");
    expect(body.organization.tradeRole).toBe("both");
    expect(body.context.tradeRole).toBe("both");

    const current = await me(account.token);
    expect(current.accountType).toBe("customer");
    expect(current.tradeRole).toBe("both");
  });

  it("ignores privilege-looking account types and keeps them as ordinary customers", async () => {
    const forged = await register("forged-provider-account", { accountType: "admin" });

    expect(forged.user.accountType).toBe("customer");
    expect(forged.user.platformRole).toBeNull();
    expect(forged.user.roles).toEqual(["COMPANY_OWNER"]);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(forged.token)
    });
    expect(inbox.statusCode).toBe(403);
    expect((await json(inbox)).code).toBe("provider_account_required");
  });

  it("registers and logs in a provider without granting verification or platform roles", async () => {
    const provider = await register("provider-account", {
      accountType: "provider",
      organizationName: "Provider Account Organization"
    });

    expect(provider.user.accountType).toBe("provider");
    expect(provider.user.platformRole).toBeNull();
    expect(provider.user.roles).toEqual(["COMPANY_OWNER"]);

    const workspace = await app.inject({
      method: "GET",
      url: "/api/v1/company",
      headers: auth(provider.token)
    });
    expect(workspace.statusCode).toBe(200);
    expect((await json(workspace)).organization.name).toBe("Provider Account Organization");

    const loggedIn = await login(provider);
    expect(loggedIn.user.accountType).toBe("provider");

    const beforeProfile = await app.inject({
      method: "GET",
      url: "/api/v1/companies/mine",
      headers: auth(provider.token)
    });
    expect(beforeProfile.statusCode).toBe(200);
    expect((await json(beforeProfile)).items).toHaveLength(0);

    // A provider account may open the provider workspace, but there is no
    // eligible company and therefore no RFQ access yet.
    const opportunitiesBefore = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/opportunities",
      headers: auth(provider.token)
    });
    expect(opportunitiesBefore.statusCode).toBe(200);
    expect((await json(opportunitiesBefore)).items).toHaveLength(0);

    const company = await createCompany(provider.token, {
      name: `Provider Profile ${Math.random().toString(36).slice(2, 8)}`
    });
    expect(company.verificationStatus).toBe("unregistered");
    expect(company.status).toBe("draft");
    expect(company.type).toBe("forwarder");
    expect(company.services).toHaveLength(1);
    expect(company.services[0].mode).toBe("SEA");

    const afterProfile = await app.inject({
      method: "GET",
      url: "/api/v1/companies/mine",
      headers: auth(provider.token)
    });
    expect(afterProfile.statusCode).toBe(200);
    expect((await json(afterProfile)).items).toHaveLength(1);

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(provider.token)
    });
    expect(inbox.statusCode).toBe(200);
    expect((await json(inbox)).items).toHaveLength(0);

    // Registration/profile creation is distinct from verification.
    const profile = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${company.id}`
    });
    expect(profile.statusCode).toBe(200);
    const profileBody = await json(profile);
    expect(profileBody.isRegistered).toBe(true);
    expect(profileBody.verificationStatus).toBe("unregistered");
  });

  it("denies customer-to-provider escalation until an explicit provider profile exists", async () => {
    const customer = await register("customer-escalation", {
      accountType: "customer",
      tradeRole: "importer"
    });
    const rfq = await createRfq(customer.token);

    for (const [method, url, payload] of [
      ["GET", "/api/v1/rfqs/incoming", undefined],
      ["GET", "/api/v1/rfqs/opportunities", undefined],
      ["POST", `/api/v1/rfqs/${rfq.id}/join`, { companyId: "not-owned" }],
      [
        "POST",
        `/api/v1/rfqs/${rfq.id}/quotes`,
        {
          companyId: "not-owned",
          currency: "USD",
          transitDays: 10,
          validityUntil: new Date(Date.now() + 86_400_000).toISOString(),
          items: [{ label: "Freight", amount: 100, currency: "USD" }]
        }
      ]
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: auth(customer.token),
        ...(payload ? { payload } : {})
      });
      expect(response.statusCode).toBe(403);
      expect((await json(response)).code).toBe("provider_account_required");
    }

    // The same account has ordinary customer authority and can create RFQs.
    expect((await me(customer.token)).accountType).toBe("customer");

    // Creating a provider profile is an explicit, owner-authorized transition.
    await createCompany(customer.token, {
      name: `Explicit Provider ${Math.random().toString(36).slice(2, 8)}`
    });
    const upgraded = await me(customer.token);
    expect(upgraded.accountType).toBe("provider");

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(customer.token)
    });
    expect(inbox.statusCode).toBe(200);
  });

  it("limits a provider employee to its organization membership permissions", async () => {
    const provider = await register("employee-provider", {
      accountType: "provider",
      organizationName: "Employee Provider Organization"
    });
    const company = await createCompany(provider.token, {
      name: `Employee Provider ${Math.random().toString(36).slice(2, 8)}`
    });
    const employee = await register("provider-employee", {
      accountType: "customer",
      tradeRole: "both"
    });

    const invitationResponse = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(provider.token),
      payload: { email: employee.email, role: "VIEWER" }
    });
    expect(invitationResponse.statusCode).toBe(200);
    const invitation = (await json(invitationResponse)).invitation;

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/auth/company-invitations/memberships/${invitation.id}/accept`,
      headers: auth(employee.token)
    });
    expect(accept.statusCode).toBe(200);

    const switched = await switchOrganization(employee.token, provider.user.organizationId);
    const employeeToken = switched.token as string;
    const employeeUser = await me(employeeToken);
    expect(employeeUser.accountType).toBe("provider");
    expect(employeeUser.roles).toEqual(["VIEWER"]);
    expect(employeeUser.platformRole).toBeNull();

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(employeeToken)
    });
    expect(inbox.statusCode).toBe(200);

    const customer = await register("employee-customer", {
      accountType: "customer",
      tradeRole: "exporter"
    });
    const rfq = await createRfq(customer.token, [company.id]);
    const quote = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.id}/quotes`,
      headers: auth(employeeToken),
      payload: {
        companyId: company.id,
        currency: "USD",
        transitDays: 10,
        validityUntil: new Date(Date.now() + 86_400_000).toISOString(),
        items: [{ label: "Freight", amount: 100, currency: "USD" }]
      }
    });
    expect(quote.statusCode).toBe(403);
    expect((await json(quote)).code).toBe("insufficient_company_permission");
  });

  it("denies a different provider organization access to a customer RFQ", async () => {
    const customer = await register("cross-customer", {
      accountType: "customer",
      tradeRole: "importer"
    });
    const invitedProvider = await register("cross-invited", { accountType: "provider" });
    const rivalProvider = await register("cross-rival", { accountType: "provider" });
    const invitedCompany = await createCompany(invitedProvider.token, {
      name: `Invited Provider ${Math.random().toString(36).slice(2, 8)}`
    });
    await createCompany(rivalProvider.token, {
      name: `Rival Provider ${Math.random().toString(36).slice(2, 8)}`
    });
    const rfq = await createRfq(customer.token, [invitedCompany.id]);

    const invited = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.id}`,
      headers: auth(invitedProvider.token)
    });
    expect(invited.statusCode).toBe(200);

    const rival = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.id}`,
      headers: auth(rivalProvider.token)
    });
    expect(rival.statusCode).toBe(403);
  });

  it("keeps platform administration outside customer/provider workspaces", async () => {
    const admin: CreatedAdmin = await createPlatformAdmin(app, "ADMIN", {
      emailPrefix: "account-separation-admin"
    });
    createdAdminIds.push(admin.id);
    expect(admin.token).toBeTruthy();

    const providerInbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(admin.token!)
    });
    expect(providerInbox.statusCode).toBe(403);
    // The company-session check runs first and rejects the admin-scoped token
    // before provider classification can be consulted.
    expect((await json(providerInbox)).code).toBe("company_session_required");

    const workspace = await app.inject({
      method: "GET",
      url: "/api/v1/company",
      headers: auth(admin.token!)
    });
    expect(workspace.statusCode).toBe(403);
    expect((await json(workspace)).code).toBe("company_session_required");

    const current = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(admin.token!)
    });
    expect(current.statusCode).toBe(200);
    expect((await json(current)).user.platformRole).toBe("ADMIN");
    expect((await json(current)).user.scope).toBe("admin");
  });

  it("keeps pre-classification tokens compatible while reading the new DB state", async () => {
    const account = await register("legacy-token", {
      accountType: "customer",
      tradeRole: "importer"
    });
    await createCompany(account.token, {
      name: `Legacy Token Provider ${Math.random().toString(36).slice(2, 8)}`
    });

    // Simulate a token minted before accountType/tradeRole were added. The
    // authentication middleware reloads the organization from PostgreSQL.
    const legacyToken = app.jwt.sign(
      {
        sub: account.user.id,
        email: account.user.email,
        displayName: account.user.displayName,
        organizationId: account.user.organizationId,
        roles: account.user.roles,
        platformRole: null,
        status: "active",
        sv: 0,
        scope: "app"
      },
      { expiresIn: "1h" }
    );

    const current = await me(legacyToken);
    expect(current.accountType).toBe("provider");
    expect(current.tradeRole).toBe("importer");

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(legacyToken)
    });
    expect(inbox.statusCode).toBe(200);
  });
});

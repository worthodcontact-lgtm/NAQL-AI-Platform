import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { cleanupPlatformUser, createPlatformAdmin, CreatedAdmin } from "./helpers/admin.js";

/**
 * Acceptance tests for the three-scope separation:
 *   1. platform administration,
 *   2. company workspace,
 *   3. per-shipment collaboration.
 *
 * These tests require PostgreSQL because they exercise memberships, invitations,
 * shipment parties and audit rows. They never run against a non-local database:
 * `config/env.ts` rejects remote DATABASE_URL values during tests.
 */
const hasDatabase = Boolean(prisma);
const suite = hasDatabase ? describe : describe.skip;

let app: any;
const stamp = Date.now();
const createdAdminIds: string[] = [];

function auth(token: string | null | undefined) {
  return { authorization: `Bearer ${token}` };
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF");
const PDF_BASE64 = PDF_BYTES.toString("base64");

async function json(res: any) {
  try {
    return JSON.parse(res.payload);
  } catch {
    return null;
  }
}

async function register(prefix: string, invitationToken?: string, emailOverride?: string) {
  const email = emailOverride ?? `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7)}@naql.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email,
      password: "password123",
      displayName: `${prefix} tester`,
      ...(invitationToken ? { invitationToken } : {})
    }
  });
  expect(res.statusCode).toBe(200);
  const body = await json(res);
  return { email, token: body.token as string, user: body.user };
}

async function registerCompany(token: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/companies/register",
    headers: auth(token),
    payload: { name, type: "forwarder", country: "EG", listed: true }
  });
  expect(res.statusCode).toBe(200);
  return json(res);
}

async function firstPorts() {
  const res = await app.inject({ method: "GET", url: "/api/v1/ports" });
  expect(res.statusCode).toBe(200);
  const body = await json(res);
  expect(body.items.length).toBeGreaterThan(1);
  return { origin: body.items[0].code, destination: body.items[1].code };
}

async function createShipment(token: string, ports = { origin: "JED", destination: "RUH" }) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/shipments",
    headers: auth(token),
    payload: {
      originPortId: ports.origin,
      destinationPortId: ports.destination,
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription: `Separation test cargo ${Math.random()}`,
      weightKg: 500
    }
  });
  expect(res.statusCode).toBe(200);
  return json(res);
}

async function addParty(
  ownerToken: string,
  shipmentId: string,
  companyId: string,
  permissions: Record<string, boolean> = {}
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/shipments/${shipmentId}/parties`,
    headers: auth(ownerToken),
    payload: { companyId, partyRole: "FREIGHT_FORWARDER", permissions }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).party;
}

suite("access-control separation", () => {
  let ports: { origin: string; destination: string };
  let owner: { email: string; token: string; user: any };
  let ownerCompanyId: string;
  let provider: { email: string; token: string; user: any };
  let providerCompanyId: string;
  let shipmentId: string;

  beforeAll(async () => {
    if (!hasDatabase) return;
    app = await buildApp();
    await app.ready();
    ports = await firstPorts();

    owner = await register("owner");
    ownerCompanyId = (await registerCompany(owner.token, `Owner Company ${stamp}`)).id;
    provider = await register("provider");
    providerCompanyId = (await registerCompany(provider.token, `Provider Company ${stamp}`)).id;
    shipmentId = (await createShipment(owner.token, ports)).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const id of createdAdminIds) await cleanupPlatformUser(id);
  });

  it("denies a non-party company any read or write access to a guessed shipment id", async () => {
    const guessed = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}`,
      headers: auth(provider.token)
    });
    expect(guessed.statusCode).toBe(404);

    const update = await app.inject({
      method: "PATCH",
      url: `/api/v1/shipments/${shipmentId}/status`,
      headers: auth(provider.token),
      payload: { status: "QUOTATION_REQUESTED" }
    });
    expect(update.statusCode).toBe(404);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/shipments/${shipmentId}`,
      headers: auth(provider.token)
    });
    expect(removed.statusCode).toBe(404);
  });

  it("shows a party only its own row and enforces per-shipment permission flags", async () => {
    const party = await addParty(owner.token, shipmentId, providerCompanyId, {
      canView: true,
      canViewDocuments: true
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}`,
      headers: auth(provider.token)
    });
    expect(detail.statusCode).toBe(200);
    const body = await json(detail);
    expect(body.viewerRole).toBe("party");
    expect(body.organizationId).toBeUndefined();
    expect(body.parties).toHaveLength(1);
    expect(body.parties[0].id).toBe(party.id);
    expect(body.access.canUpdateStatus).toBe(false);

    // Owner uploads two documents: one shared and one private.
    const shared = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(owner.token),
      payload: {
        type: "invoice",
        filename: "shared.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        visibility: "shipment",
        dataBase64: PDF_BASE64
      }
    });
    expect(shared.statusCode).toBe(200);
    expect((await json(shared)).storageKey).toBeUndefined();

    const privateDoc = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(owner.token),
      payload: {
        type: "purchase_order",
        filename: "private.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        visibility: "private",
        dataBase64: PDF_BASE64
      }
    });
    expect(privateDoc.statusCode).toBe(200);
    const privateDocId = (await json(privateDoc)).id;

    const docs = await app.inject({
      method: "GET",
      url: `/api/v1/documents?shipmentId=${shipmentId}`,
      headers: auth(provider.token)
    });
    expect(docs.statusCode).toBe(200);
    const docItems = (await json(docs)).items;
    expect(docItems.map((doc: any) => doc.filename)).toEqual(["shared.pdf"]);
    expect(docItems[0].storageKey).toBeUndefined();
    expect(docItems[0].uploadedByOrganizationId).toBeUndefined();

    // A document id from the owner's private document must not be readable.
    const privateRead = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${privateDocId}`,
      headers: auth(provider.token)
    });
    expect(privateRead.statusCode).toBe(404);

    // Flag is false: uploading and status updates are rejected even though the
    // provider's company role would otherwise allow both.
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(provider.token),
      payload: {
        type: "packing_list",
        filename: "provider.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        dataBase64: PDF_BASE64
      }
    });
    expect(upload.statusCode).toBe(403);

    const status = await app.inject({
      method: "PATCH",
      url: `/api/v1/shipments/${shipmentId}/status`,
      headers: auth(provider.token),
      payload: { status: "QUOTATION_REQUESTED" }
    });
    expect(status.statusCode).toBe(403);

    // Owner grants operational permissions; the same calls now succeed.
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/shipments/${shipmentId}/parties/${party.id}`,
      headers: auth(owner.token),
      payload: {
        permissions: {
          canUpdateStatus: true,
          canUploadDocuments: true,
          canViewFinancials: true,
          canQuote: true
        }
      }
    });
    expect(patch.statusCode).toBe(200);

    const uploadAllowed = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(provider.token),
      payload: {
        type: "packing_list",
        filename: "provider.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        visibility: "private",
        dataBase64: PDF_BASE64
      }
    });
    expect(uploadAllowed.statusCode).toBe(200);
    const providerDocId = (await json(uploadAllowed)).id;

    // A third party in the same shipment must not see the provider's private
    // document, even though it can see the shared document.
    const docRival = await register("doc-rival");
    const docRivalCompany = await registerCompany(docRival.token, `Doc Rival ${stamp}`);
    await addParty(owner.token, shipmentId, docRivalCompany.id, {
      canView: true,
      canViewDocuments: true
    });
    const rivalDocs = await app.inject({
      method: "GET",
      url: `/api/v1/documents?shipmentId=${shipmentId}`,
      headers: auth(docRival.token)
    });
    expect(rivalDocs.statusCode).toBe(200);
    const rivalFilenames = (await json(rivalDocs)).items.map((doc: any) => doc.filename);
    expect(rivalFilenames).toEqual(["shared.pdf"]);
    expect(rivalFilenames).not.toContain("provider.pdf");

    const rivalPrivateRead = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${providerDocId}`,
      headers: auth(docRival.token)
    });
    expect(rivalPrivateRead.statusCode).toBe(404);

    const statusAllowed = await app.inject({
      method: "PATCH",
      url: `/api/v1/shipments/${shipmentId}/status`,
      headers: auth(provider.token),
      payload: { status: "QUOTATION_REQUESTED" }
    });
    expect(statusAllowed.statusCode).toBe(200);
  });

  it("prevents a party from escalating its own shipment permissions", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}`,
      headers: auth(owner.token)
    });
    const party = (await json(detail)).parties.find(
      (row: any) => row.companyId === providerCompanyId
    );
    expect(party).toBeTruthy();

    const grant = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/parties`,
      headers: auth(owner.token),
      payload: {
        companyId: providerCompanyId,
        partyRole: "FREIGHT_FORWARDER",
        permissions: { canManageParties: true }
      }
    });
    expect(grant.statusCode).toBe(200);

    const selfElevate = await app.inject({
      method: "PATCH",
      url: `/api/v1/shipments/${shipmentId}/parties/${party.id}`,
      headers: auth(provider.token),
      payload: { permissions: { canViewFinancials: true, canManageParties: true } }
    });
    expect(selfElevate.statusCode).toBe(403);
  });

  it("lets a party see and bid on a quotation only when explicitly granted", async () => {
    const request = await app.inject({
      method: "POST",
      url: "/api/v1/quotations",
      headers: auth(owner.token),
      payload: { shipmentId }
    });
    expect(request.statusCode).toBe(200);
    const quotationId = (await json(request)).id;

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/quotations",
      headers: auth(provider.token)
    });
    expect(list.statusCode).toBe(200);
    const providerRequests = (await json(list)).items;
    expect(providerRequests.some((item: any) => item.id === quotationId)).toBe(true);

    const offer = await app.inject({
      method: "POST",
      url: `/api/v1/quotations/${quotationId}/offers`,
      headers: auth(provider.token),
      payload: {
        providerId: providerCompanyId,
        currency: "USD",
        amount: 1500,
        transitDays: 10,
        validityUntil: new Date(Date.now() + 86_400_000).toISOString()
      }
    });
    expect(offer.statusCode).toBe(200);

    const ownerDetail = await app.inject({
      method: "GET",
      url: `/api/v1/quotations/${quotationId}`,
      headers: auth(owner.token)
    });
    expect(ownerDetail.statusCode).toBe(200);
    expect((await json(ownerDetail)).offers).toHaveLength(1);

    // A different party never sees the first provider's bid.
    const rival = await register("rival");
    const rivalCompany = await registerCompany(rival.token, `Rival Company ${stamp}`);
    await addParty(owner.token, shipmentId, rivalCompany.id, {
      canView: true,
      canViewFinancials: true,
      canQuote: true
    });
    const rivalDetail = await app.inject({
      method: "GET",
      url: `/api/v1/quotations/${quotationId}`,
      headers: auth(rival.token)
    });
    expect(rivalDetail.statusCode).toBe(200);
    expect((await json(rivalDetail)).offers).toHaveLength(0);
  });

  it("invites a new member with an explicit role and blocks self-promotion", async () => {
    const inviteEmail = `viewer-${stamp}-${Math.random().toString(36).slice(2, 7)}@naql.test`;
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(owner.token),
      payload: { email: inviteEmail, role: "VIEWER" }
    });
    expect(invite.statusCode).toBe(200);
    const invitation = (await json(invite)).invitation;
    expect(invitation.kind).toBe("email");
    expect(invitation.token).toBeTruthy();

    const viewer = await register(`viewer-${stamp}`, invitation.token, inviteEmail);
    expect(viewer.user.organizationId).toBe(owner.user.organizationId);
    expect(viewer.user.roles).toEqual(["VIEWER"]);

    const canRead = await app.inject({
      method: "GET",
      url: "/api/v1/shipments",
      headers: auth(viewer.token)
    });
    expect(canRead.statusCode).toBe(200);

    const cannotCreate = await app.inject({
      method: "POST",
      url: "/api/v1/shipments",
      headers: auth(viewer.token),
      payload: {
        originPortId: ports.origin,
        destinationPortId: ports.destination,
        mode: "SEA",
        incoterm: "FOB",
        cargoDescription: "viewer attempt",
        weightKg: 10
      }
    });
    expect(cannotCreate.statusCode).toBe(403);

    const cannotSeeMembers = await app.inject({
      method: "GET",
      url: "/api/v1/company/members",
      headers: auth(viewer.token)
    });
    expect(cannotSeeMembers.statusCode).toBe(403);

    const members = await app.inject({
      method: "GET",
      url: "/api/v1/company/members",
      headers: auth(owner.token)
    });
    const viewerMembership = (await json(members)).items.find(
      (item: any) => item.user.email === inviteEmail
    );
    expect(viewerMembership.role).toBe("VIEWER");

    // Invitations are bound to the invited account, not just to an id.
    const stolenAccept = await app.inject({
      method: "POST",
      url: `/api/v1/auth/company-invitations/memberships/${viewerMembership.id}/accept`,
      headers: auth(owner.token)
    });
    expect(stolenAccept.statusCode).toBe(404);

    const selfPromote = await app.inject({
      method: "PATCH",
      url: `/api/v1/company/members/${viewerMembership.id}`,
      headers: auth(viewer.token),
      payload: { role: "COMPANY_OWNER" }
    });
    expect(selfPromote.statusCode).toBe(403);
  });

  it("denies switching into a workspace without an active membership", async () => {
    const outsider = await register("outsider");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: auth(outsider.token),
      payload: { organizationId: owner.user.organizationId }
    });
    expect(res.statusCode).toBe(403);
    expect((await json(res)).code).toBe("membership_required");
  });

  it("lets an existing user accept an invitation and switch workspaces without leaking data", async () => {
    const switcher = await register("switcher");
    const ownShipment = await createShipment(switcher.token, ports);

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(owner.token),
      payload: { email: switcher.email, role: "OPERATIONS_MANAGER" }
    });
    expect(invite.statusCode).toBe(200);
    const invitation = (await json(invite)).invitation;
    expect(invitation.kind).toBe("membership");

    const pending = await app.inject({
      method: "GET",
      url: "/api/v1/auth/company-invitations",
      headers: auth(switcher.token)
    });
    expect(pending.statusCode).toBe(200);
    const pendingBody = await json(pending);
    const membershipInvite = pendingBody.memberships.find(
      (item: any) => item.id === invitation.id
    );
    expect(membershipInvite).toBeTruthy();

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/auth/company-invitations/memberships/${invitation.id}/accept`,
      headers: auth(switcher.token)
    });
    expect(accept.statusCode).toBe(200);
    expect((await json(accept)).switchRequired).toBe(true);

    const switched = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: auth(switcher.token),
      payload: { organizationId: owner.user.organizationId }
    });
    expect(switched.statusCode).toBe(200);
    const newToken = (await json(switched)).token as string;

    // The old token is revoked by the session-version bump.
    const oldToken = await app.inject({
      method: "GET",
      url: "/api/v1/shipments",
      headers: auth(switcher.token)
    });
    expect(oldToken.statusCode).toBe(401);

    // The new token sees the new workspace only, never the previous one.
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/shipments",
      headers: auth(newToken)
    });
    expect(list.statusCode).toBe(200);
    const items = (await json(list)).items;
    expect(items.some((item: any) => item.id === shipmentId)).toBe(true);
    expect(items.some((item: any) => item.id === ownShipment.id)).toBe(false);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(newToken)
    });
    expect((await json(me)).user.organizationId).toBe(owner.user.organizationId);
  });

  it("does not let a company admin grant ownership or modify an owner", async () => {
    const admin = await register("company-admin");
    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(owner.token),
      payload: { email: admin.email, role: "COMPANY_ADMIN" }
    });
    expect(invite.statusCode).toBe(200);
    const invitation = (await json(invite)).invitation;

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/auth/company-invitations/memberships/${invitation.id}/accept`,
      headers: auth(admin.token)
    });
    expect(accept.statusCode).toBe(200);

    const switched = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: auth(admin.token),
      payload: { organizationId: owner.user.organizationId }
    });
    expect(switched.statusCode).toBe(200);
    const adminToken = (await json(switched)).token as string;

    const grantsOwner = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(adminToken),
      payload: { email: `would-be-owner-${stamp}@naql.test`, role: "COMPANY_OWNER" }
    });
    expect(grantsOwner.statusCode).toBe(403);

    const members = await app.inject({
      method: "GET",
      url: "/api/v1/company/members",
      headers: auth(adminToken)
    });
    const ownerMembership = (await json(members)).items.find(
      (item: any) => item.user.email === owner.email
    );

    const demoteOwner = await app.inject({
      method: "PATCH",
      url: `/api/v1/company/members/${ownerMembership.id}`,
      headers: auth(adminToken),
      payload: { role: "VIEWER" }
    });
    expect(demoteOwner.statusCode).toBe(403);

    const removeOwner = await app.inject({
      method: "DELETE",
      url: `/api/v1/company/members/${ownerMembership.id}`,
      headers: auth(adminToken)
    });
    expect(removeOwner.statusCode).toBe(403);
  });

  it("rejects an administration session on company routes", async () => {
    const support: CreatedAdmin = await createPlatformAdmin(app, "SUPPORT", {
      emailPrefix: "scope-support"
    });
    createdAdminIds.push(support.id);
    expect(support.token).toBeTruthy();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/shipments",
      headers: auth(support.token)
    });
    expect(res.statusCode).toBe(403);
    expect((await json(res)).code).toBe("company_session_required");
  });

  it("keeps routine support out of sensitive documents and audits exceptional access", async () => {
    const support: CreatedAdmin = await createPlatformAdmin(app, "SUPPORT", {
      emailPrefix: "docs-support"
    });
    createdAdminIds.push(support.id);
    const superAdmin: CreatedAdmin = await createPlatformAdmin(app, "SUPER_ADMIN", {
      emailPrefix: "docs-super"
    });
    createdAdminIds.push(superAdmin.id);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/admin/shipments/${shipmentId}`,
      headers: auth(support.token)
    });
    expect(detail.statusCode).toBe(200);
    expect((await json(detail)).shipment.documents).toBeUndefined();

    const supportDocs = await app.inject({
      method: "GET",
      url: `/api/v1/admin/shipments/${shipmentId}/documents?reason=customer%20support%20ticket`,
      headers: auth(support.token)
    });
    expect(supportDocs.statusCode).toBe(403);

    const noReason = await app.inject({
      method: "GET",
      url: `/api/v1/admin/shipments/${shipmentId}/documents`,
      headers: auth(superAdmin.token)
    });
    expect(noReason.statusCode).toBe(400);

    const superDocs = await app.inject({
      method: "GET",
      url: `/api/v1/admin/shipments/${shipmentId}/documents?reason=investigating%20a%20document%20dispute`,
      headers: auth(superAdmin.token)
    });
    expect(superDocs.statusCode).toBe(200);

    const audit = await prisma!.auditLog.findFirst({
      where: {
        action: "admin.shipment.documents.accessed",
        entityId: shipmentId,
        actorUserId: superAdmin.id
      }
    });
    expect(audit).toBeTruthy();

    // Company verification upload now requires actual validated bytes. A
    // client-supplied storageKey is no longer an accepted upload format.
    const companyDoc = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${ownerCompanyId}/documents`,
      headers: auth(owner.token),
      payload: { type: "commercial_register", filename: "cr.pdf", storageKey: "test/cr.pdf" }
    });
    expect(companyDoc.statusCode).toBe(400);
    expect(JSON.parse(companyDoc.payload).error).toBe("Invalid input");

    // Test-only metadata fixture for the administration document-access
    // boundary. It does not count as verification evidence because no object
    // exists at this key.
    await prisma!.companyDocument.create({
      data: {
        companyId: ownerCompanyId,
        type: "commercial_register",
        filename: "cr.pdf",
        storageKey: `companies/${ownerCompanyId}/documents/fixture.pdf`,
        status: "uploaded"
      }
    });

    const supportCompanyDocs = await app.inject({
      method: "GET",
      url: `/api/v1/admin/companies/${ownerCompanyId}/documents?reason=customer%20support%20ticket`,
      headers: auth(support.token)
    });
    expect(supportCompanyDocs.statusCode).toBe(403);

    const reviewer: CreatedAdmin = await createPlatformAdmin(app, "REVIEWER", {
      emailPrefix: "docs-reviewer"
    });
    createdAdminIds.push(reviewer.id);
    const reviewerDocs = await app.inject({
      method: "GET",
      url: `/api/v1/admin/companies/${ownerCompanyId}/documents?reason=verification%20review`,
      headers: auth(reviewer.token)
    });
    expect(reviewerDocs.statusCode).toBe(200);
    expect((await json(reviewerDocs)).company.documents).toHaveLength(1);

    const companyAudit = await prisma!.auditLog.findFirst({
      where: {
        action: "admin.company.documents.accessed",
        entityId: ownerCompanyId,
        actorUserId: reviewer.id
      }
    });
    expect(companyAudit).toBeTruthy();
  });
});

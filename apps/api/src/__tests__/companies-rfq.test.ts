import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { cleanupPlatformUser, createPlatformAdmin } from "./helpers/admin.js";

let app: any;
const hasDatabase = Boolean(prisma);

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

async function register(email: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: "password123", displayName: "Tester" } });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.payload).token as string;
}

describe("company directory and verification", () => {
  it("lists an unregistered company in the directory without marking it verified", async () => {
    const owner = await register(`owner-${Date.now()}@example.com`);
    const create = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: `Delta Freight ${Date.now()}`, type: "forwarder", country: "EG", listed: true }
    });
    expect(create.statusCode).toBe(200);
    const companyId = JSON.parse(create.payload).id;

    const directory = await app.inject({ method: "GET", url: "/api/v1/companies/directory" });
    const found = JSON.parse(directory.payload).items.find((c: any) => c.id === companyId);
    expect(found).toBeTruthy();
    expect(found.verificationStatus).toBe("unregistered");
  });

  it("filters listed providers by service coverage and verification state", async () => {
    const owner = await register(`directory-filter-${Date.now()}@example.com`);
    const name = `Coverage Provider ${Date.now()}`;
    const create = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${owner}` },
      payload: {
        name, type: "forwarder", country: "EG", listed: true,
        services: [{ mode: "SEA", originLocation: "Alexandria Port", destinationLocation: "Jeddah", notes: "Self-reported" }]
      }
    });
    expect(create.statusCode).toBe(200);
    const companyId = JSON.parse(create.payload).id;

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/companies/directory?coverage=Alexandria&verificationStatus=unregistered"
    });
    expect(response.statusCode).toBe(200);
    const company = JSON.parse(response.payload).items.find((item: any) => item.id === companyId);
    expect(company).toMatchObject({
      verificationStatus: "unregistered",
      dataSource: "company_profile"
    });
    expect(company.services[0]).toMatchObject({ mode: "SEA", originLocation: "Alexandria Port" });
  });

  it.skipIf(!hasDatabase)("blocks approval without real evidence and allows needs_information", async () => {
    const owner = await register(`owner2-${Date.now()}@example.com`);
    const create = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: `Nile Logistics ${Date.now()}`, type: "shipping", country: "EG" }
    });
    const companyId = JSON.parse(create.payload).id;
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/submit`, headers: { authorization: `Bearer ${owner}` }, payload: {} });

    const reviewer = await createPlatformAdmin(app, "REVIEWER");
    expect(reviewer.login.statusCode).toBe(200);

    // A metadata row with a client-chosen storageKey is not evidence that a
    // document exists. Approval must fail even when that row is present.
    await prisma!.companyDocument.create({
      data: {
        companyId,
        type: "commercial_register",
        filename: "cr.pdf",
        storageKey: `companies/${companyId}/documents/fake-evidence.pdf`,
        status: "uploaded"
      }
    });

    const approve = await app.inject({
      method: "POST", url: `/api/v1/admin/companies/${companyId}/verify`,
      headers: { authorization: `Bearer ${reviewer.token}` },
      payload: { decision: "approved", notes: "documents ok" }
    });
    expect(approve.statusCode).toBe(409);
    expect(JSON.parse(approve.payload).code).toBe("verification_evidence_required");

    const stillPending = await prisma!.company.findUnique({ where: { id: companyId } });
    expect(stillPending?.verificationStatus).toBe("pending");

    const needsInfo = await app.inject({
      method: "POST", url: `/api/v1/admin/companies/${companyId}/verify`,
      headers: { authorization: `Bearer ${reviewer.token}` },
      payload: { decision: "needs_information", notes: "Upload the commercial register through secure storage" }
    });
    expect(needsInfo.statusCode).toBe(200);
    expect(JSON.parse(needsInfo.payload).company.verificationStatus).toBe("pending");

    const audit = await app.inject({ method: "GET", url: "/api/v1/admin/audit-logs", headers: { authorization: `Bearer ${reviewer.token}` } });
    expect(JSON.parse(audit.payload).items.some((a: any) => a.action === "company.verify.needs_information")).toBe(true);
    expect(JSON.parse(audit.payload).items.some((a: any) => a.action === "company.verify.approved")).toBe(false);

    await cleanupPlatformUser(reviewer.id);
  });

  it.skipIf(!hasDatabase)("prevents a non-staff user from verifying a company", async () => {
    const owner = await register(`owner3-${Date.now()}@example.com`);
    const create = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: `Bad Actor ${Date.now()}`, type: "carrier" }
    });
    const companyId = JSON.parse(create.payload).id;
    const res = await app.inject({
      method: "POST", url: `/api/v1/admin/companies/${companyId}/verify`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { decision: "approved" }
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).code).toBe("admin_session_required");
  });
});

describe("RFQ, quote, and booking workflow", () => {
  it("runs the flow and keeps booking unconfirmed until provider confirms", async () => {
    const customer = await register(`customer-${Date.now()}@example.com`);
    const provider = await register(`provider-${Date.now()}@example.com`);

    const providerCompany = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${provider}` },
      payload: { name: `Provider Co ${Date.now()}`, type: "forwarder", country: "EG" }
    });
    const companyId = JSON.parse(providerCompany.payload).id;

    const rfqRes = await app.inject({
      method: "POST", url: "/api/v1/rfqs",
      headers: { authorization: `Bearer ${customer}` },
      payload: { origin: "CAI", destination: "JED", mode: "SEA", cargoDescription: "textiles", weightKg: 1200, recipientCompanyIds: [companyId] }
    });
    expect(rfqRes.statusCode).toBe(200);
    const rfqId = JSON.parse(rfqRes.payload).id;

    const quoteRes = await app.inject({
      method: "POST", url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: { authorization: `Bearer ${provider}` },
      payload: { companyId, currency: "USD", transitDays: 12, validityUntil: new Date(Date.now() + 7 * 86400000).toISOString(), items: [{ label: "Ocean freight", amount: 1500, currency: "USD" }, { label: "Documentation", amount: 100, currency: "USD" }] }
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = JSON.parse(quoteRes.payload);
    expect(quote.totalAmount).toBe(1600);

    const acceptRes = await app.inject({
      method: "POST", url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: { authorization: `Bearer ${customer}` },
      payload: { quoteId: quote.id }
    });
    expect(acceptRes.statusCode).toBe(200);
    const booking = JSON.parse(acceptRes.payload);
    expect(booking.status).toBe("requested");
    // `null` in database mode, `undefined` in the in-memory fallback: both mean unconfirmed.
    expect(booking.confirmedAt ?? null).toBeNull();

    // The customer who accepted the quote must NOT be able to confirm their own booking.
    const selfConfirm = await app.inject({
      method: "POST", url: `/api/v1/bookings/${booking.id}/confirm`,
      headers: { authorization: `Bearer ${customer}` },
      payload: { externalReference: "SELF-1" }
    });
    expect(selfConfirm.statusCode).toBe(403);

    // Nor may an unrelated authenticated user confirm it.
    const stranger = await register(`stranger-${Date.now()}@example.com`);
    const strangerConfirm = await app.inject({
      method: "POST", url: `/api/v1/bookings/${booking.id}/confirm`,
      headers: { authorization: `Bearer ${stranger}` },
      payload: { externalReference: "STRANGER-1" }
    });
    expect(strangerConfirm.statusCode).toBe(403);

    // Confirmation without an external reference is rejected.
    const missingRef = await app.inject({
      method: "POST", url: `/api/v1/bookings/${booking.id}/confirm`,
      headers: { authorization: `Bearer ${provider}` },
      payload: {}
    });
    expect(missingRef.statusCode).toBe(400);

    const confirmRes = await app.inject({
      method: "POST", url: `/api/v1/bookings/${booking.id}/confirm`,
      headers: { authorization: `Bearer ${provider}` },
      payload: { externalReference: "EXT-123" }
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(JSON.parse(confirmRes.payload).status).toBe("confirmed");

    // A confirmed booking cannot be confirmed again.
    const doubleConfirm = await app.inject({
      method: "POST", url: `/api/v1/bookings/${booking.id}/confirm`,
      headers: { authorization: `Bearer ${provider}` },
      payload: { externalReference: "EXT-456" }
    });
    expect(doubleConfirm.statusCode).toBe(409);
  });

  it("lets the provider reject a booking request and records the outcome", async () => {
    const customer = await register(`rej-customer-${Date.now()}@example.com`);
    const provider = await register(`rej-provider-${Date.now()}@example.com`);
    const companyRes = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${provider}` },
      payload: { name: `Reject Co ${Date.now()}`, type: "forwarder", country: "EG" }
    });
    const companyId = JSON.parse(companyRes.payload).id;

    const rfqRes = await app.inject({
      method: "POST", url: "/api/v1/rfqs",
      headers: { authorization: `Bearer ${customer}` },
      payload: { origin: "ALX", destination: "IST", mode: "SEA", cargoDescription: "cotton", weightKg: 900, recipientCompanyIds: [companyId] }
    });
    const rfqId = JSON.parse(rfqRes.payload).id;

    const quoteRes = await app.inject({
      method: "POST", url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: { authorization: `Bearer ${provider}` },
      payload: { companyId, currency: "USD", transitDays: 9, validityUntil: new Date(Date.now() + 5 * 86400000).toISOString(), items: [{ label: "Freight", amount: 800, currency: "USD" }] }
    });
    const quote = JSON.parse(quoteRes.payload);

    const acceptRes = await app.inject({
      method: "POST", url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: { authorization: `Bearer ${customer}` },
      payload: { quoteId: quote.id }
    });
    const bookingId = JSON.parse(acceptRes.payload).id;

    const rejectRes = await app.inject({
      method: "POST", url: `/api/v1/bookings/${bookingId}/reject`,
      headers: { authorization: `Bearer ${provider}` },
      payload: { reason: "No capacity" }
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(JSON.parse(rejectRes.payload).status).toBe("rejected");
  });

  it("does not expose competing quotes to an invited provider", async () => {
    const customer = await register(`comp-customer-${Date.now()}@example.com`);
    const providerA = await register(`comp-provider-a-${Date.now()}@example.com`);
    const providerB = await register(`comp-provider-b-${Date.now()}@example.com`);

    async function createProviderCompany(token: string, name: string) {
      const res = await app.inject({
        method: "POST", url: "/api/v1/companies/register",
        headers: { authorization: `Bearer ${token}` },
        payload: { name, type: "forwarder", country: "EG" }
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload).id as string;
    }

    const companyA = await createProviderCompany(providerA, `Provider A ${Date.now()}`);
    const companyB = await createProviderCompany(providerB, `Provider B ${Date.now()}`);

    const rfqRes = await app.inject({
      method: "POST", url: "/api/v1/rfqs",
      headers: { authorization: `Bearer ${customer}` },
      payload: {
        origin: "CAI",
        destination: "JED",
        mode: "SEA",
        cargoDescription: "machinery",
        weightKg: 1000,
        recipientCompanyIds: [companyA, companyB]
      }
    });
    expect(rfqRes.statusCode).toBe(200);
    const rfqId = JSON.parse(rfqRes.payload).id;

    async function submitQuote(token: string, companyId: string, amount: number) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/rfqs/${rfqId}/quotes`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          companyId,
          currency: "USD",
          transitDays: 10,
          validityUntil: new Date(Date.now() + 5 * 86400000).toISOString(),
          items: [{ label: "Freight", amount, currency: "USD" }]
        }
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload).id as string;
    }

    const quoteA = await submitQuote(providerA, companyA, 1000);
    await submitQuote(providerB, companyB, 2000);

    const providerView = await app.inject({
      method: "GET", url: `/api/v1/rfqs/${rfqId}`,
      headers: { authorization: `Bearer ${providerA}` }
    });
    expect(providerView.statusCode).toBe(200);
    const providerRfq = JSON.parse(providerView.payload);
    expect(providerRfq.organizationId).toBeUndefined();
    expect(providerRfq.quotes).toHaveLength(1);
    expect(providerRfq.quotes[0].id).toBe(quoteA);
    expect(Number(providerRfq.quotes[0].totalAmount)).toBe(1000);

    const inbox = await app.inject({
      method: "GET", url: "/api/v1/rfqs/incoming",
      headers: { authorization: `Bearer ${providerA}` }
    });
    expect(inbox.statusCode).toBe(200);
    const inboxItem = JSON.parse(inbox.payload).items.find((item: any) => item.rfqId === rfqId);
    expect(inboxItem.rfq.quotes).toHaveLength(1);
    expect(inboxItem.rfq.quotes[0].id).toBe(quoteA);

    const customerView = await app.inject({
      method: "GET", url: `/api/v1/rfqs/${rfqId}`,
      headers: { authorization: `Bearer ${customer}` }
    });
    expect(JSON.parse(customerView.payload).quotes).toHaveLength(2);

    const accept = await app.inject({
      method: "POST", url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: { authorization: `Bearer ${customer}` },
      payload: { quoteId: quoteA }
    });
    expect(accept.statusCode).toBe(200);
    const bookingId = JSON.parse(accept.payload).id;

    const booking = await app.inject({
      method: "GET", url: `/api/v1/bookings/${bookingId}`,
      headers: { authorization: `Bearer ${providerA}` }
    });
    expect(booking.statusCode).toBe(200);
    const providerBooking = JSON.parse(booking.payload);
    expect(providerBooking.organizationId).toBeUndefined();
    expect(providerBooking.rfq.quotes).toHaveLength(1);
    expect(providerBooking.rfq.quotes[0].id).toBe(quoteA);

    const bookingList = await app.inject({
      method: "GET", url: "/api/v1/bookings",
      headers: { authorization: `Bearer ${providerA}` }
    });
    const listed = JSON.parse(bookingList.payload).items.find((item: any) => item.id === bookingId);
    expect(listed.rfq.quotes).toHaveLength(1);
    expect(listed.rfq.quotes[0].id).toBe(quoteA);
  });

  it("enforces tenant isolation on RFQs", async () => {
    const customer = await register(`customer2-${Date.now()}@example.com`);
    const outsider = await register(`outsider-${Date.now()}@example.com`);
    const rfqRes = await app.inject({
      method: "POST", url: "/api/v1/rfqs",
      headers: { authorization: `Bearer ${customer}` },
      payload: { origin: "CAI", destination: "DXB", mode: "AIR", cargoDescription: "electronics", weightKg: 300 }
    });
    const rfqId = JSON.parse(rfqRes.payload).id;
    const res = await app.inject({ method: "GET", url: `/api/v1/rfqs/${rfqId}`, headers: { authorization: `Bearer ${outsider}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe("registration privilege boundaries", () => {
  it("never grants a platform role, even when a client submits an accountType", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/register",
      payload: {
        email: `typed-admin-${Date.now()}@example.com`,
        password: "password123",
        displayName: "Typed Admin",
        accountType: "admin"
      }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.user.roles).toEqual(["COMPANY_OWNER"]);
    expect(body.user.platformRole).toBeNull();
  });

  it("ignores unknown privilege hints instead of elevating the account", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/register",
      payload: {
        email: `bad-type-${Date.now()}@example.com`,
        password: "password123",
        displayName: "Bad Type",
        accountType: "root"
      }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).user.platformRole).toBeNull();
  });

  it("does not grant platform authority for an 'admin' email prefix", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/register",
      payload: {
        email: `admin-${Date.now()}@example.com`,
        password: "password123",
        displayName: "Admin Prefix"
      }
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).user.platformRole).toBeNull();
  });
});

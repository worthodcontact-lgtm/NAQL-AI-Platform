import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";

let app: any;

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

  it("allows a reviewer to approve a company and records a review", async () => {
    const owner = await register(`owner2-${Date.now()}@example.com`);
    const create = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: `Nile Logistics ${Date.now()}`, type: "shipping", country: "EG" }
    });
    const companyId = JSON.parse(create.payload).id;
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/submit`, headers: { authorization: `Bearer ${owner}` }, payload: {} });

    const reviewer = await register(`reviewer-${Date.now()}@example.com`);
    const approve = await app.inject({
      method: "POST", url: `/api/v1/admin/companies/${companyId}/verify`,
      headers: { authorization: `Bearer ${reviewer}` },
      payload: { decision: "approved", notes: "documents ok" }
    });
    expect(approve.statusCode).toBe(200);
    expect(JSON.parse(approve.payload).verificationStatus).toBe("verified");

    const audit = await app.inject({ method: "GET", url: "/api/v1/admin/audit", headers: { authorization: `Bearer ${reviewer}` } });
    expect(JSON.parse(audit.payload).items.some((a: any) => a.action === "company.verify.approved")).toBe(true);
  });

  it("prevents a non-staff user from verifying a company", async () => {
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

describe("account type selection (development hint)", () => {
  async function registerWith(accountType: string) {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/register",
      payload: { email: `typed-${accountType}-${Date.now()}@example.com`, password: "password123", displayName: "Typed", accountType }
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload);
  }

  it("maps an explicit reviewer account type to reviewer roles", async () => {
    const { user } = await registerWith("reviewer");
    expect(user.roles).toContain("REVIEWER");
    expect(user.roles).not.toContain("SUPER_ADMIN");
  });

  it("maps an explicit admin account type to SUPER_ADMIN", async () => {
    const { user } = await registerWith("admin");
    expect(user.roles).toContain("SUPER_ADMIN");
  });

  it("keeps customer and company accounts as ordinary organization admins", async () => {
    const customer = await registerWith("customer");
    const company = await registerWith("company");
    expect(customer.user.roles).toEqual(["ORG_ADMIN"]);
    expect(company.user.roles).toEqual(["ORG_ADMIN"]);
  });

  it("rejects an unknown account type", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/v1/auth/register",
      payload: { email: `bad-type-${Date.now()}@example.com`, password: "password123", displayName: "Bad", accountType: "root" }
    });
    expect(res.statusCode).toBe(400);
  });
});

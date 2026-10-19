import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";

/**
 * Database-backed workflow test.
 *
 * This file only runs when DATABASE_URL is configured, so the default test run
 * (in-memory development fallback) is unaffected. It exercises the real Prisma
 * code paths, which are otherwise never executed by the other suites.
 *
 *   $env:DATABASE_URL="postgresql://naql:naql@127.0.0.1:5433/naql_ai?schema=public"
 *   pnpm --filter @naql/api test
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);

let app: any;
const stamp = Date.now();

beforeAll(async () => {
  if (!hasDatabase) return;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

async function register(prefix: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: `${prefix}-${stamp}@example.com`, password: "password123", displayName: `${prefix} tester` }
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.payload).token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe.skipIf(!hasDatabase)("PostgreSQL-backed workflow", () => {
  it("persists the full RFQ to booking workflow and enforces provider-only confirmation", async () => {
    const customer = await register("pg-customer");
    const provider = await register("pg-provider");
    const stranger = await register("pg-stranger");

    // Reference data must come from the database, not from an empty array.
    const ports = await app.inject({ method: "GET", url: "/api/v1/ports?country=EG" });
    expect(ports.statusCode).toBe(200);
    const portItems = JSON.parse(ports.payload).items;
    expect(portItems.length).toBeGreaterThanOrEqual(15);
    expect(portItems.every((p: any) => p.verificationStatus === "approximate")).toBe(true);

    const companyRes = await app.inject({
      method: "POST",
      url: "/api/v1/companies/register",
      headers: auth(provider),
      payload: { name: `PG Forwarder ${stamp}`, type: "forwarder", country: "EG" }
    });
    expect(companyRes.statusCode).toBe(200);
    const companyId = JSON.parse(companyRes.payload).id;

    const rfqRes = await app.inject({
      method: "POST",
      url: "/api/v1/rfqs",
      headers: auth(customer),
      payload: {
        origin: "ALY",
        destination: "CAI",
        mode: "SEA",
        cargoDescription: "cotton textiles",
        weightKg: 1200,
        recipientCompanyIds: [companyId]
      }
    });
    expect(rfqRes.statusCode).toBe(200);
    const rfqId = JSON.parse(rfqRes.payload).id;

    // Provider inbox is derived from company ownership.
    const inbox = await app.inject({ method: "GET", url: "/api/v1/rfqs/incoming", headers: auth(provider) });
    expect(inbox.statusCode).toBe(200);
    expect(JSON.parse(inbox.payload).items.some((row: any) => row.rfqId === rfqId)).toBe(true);

    // A different organization sees nothing, even though the RFQ exists.
    const strangerInbox = await app.inject({ method: "GET", url: "/api/v1/rfqs/incoming", headers: auth(stranger) });
    expect(JSON.parse(strangerInbox.payload).items.some((row: any) => row.rfqId === rfqId)).toBe(false);

    // A provider that does not own the company cannot quote.
    const foreignQuote = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: auth(stranger),
      payload: {
        companyId,
        currency: "USD",
        transitDays: 10,
        validityUntil: new Date(Date.now() + 5 * 86400000).toISOString(),
        items: [{ label: "Freight", amount: 100, currency: "USD" }]
      }
    });
    expect(foreignQuote.statusCode).toBe(403);

    // Excluded items must not contribute to the persisted total.
    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: auth(provider),
      payload: {
        companyId,
        currency: "USD",
        transitDays: 12,
        validityUntil: new Date(Date.now() + 10 * 86400000).toISOString(),
        items: [
          { label: "Freight", amount: 2400, currency: "USD" },
          { label: "Port charges", amount: 350, currency: "USD" },
          { label: "Optional insurance", amount: 999, currency: "USD", included: false }
        ]
      }
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = JSON.parse(quoteRes.payload);
    expect(Number(quote.totalAmount)).toBe(2750);

    const acceptRes = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: auth(customer),
      payload: { quoteId: quote.id }
    });
    expect(acceptRes.statusCode).toBe(200);
    const bookingId = JSON.parse(acceptRes.payload).id;

    // Accepting a quote must not confirm the booking.
    const listing = await app.inject({ method: "GET", url: "/api/v1/bookings", headers: auth(provider) });
    const seen = JSON.parse(listing.payload).items.find((b: any) => b.id === bookingId);
    expect(seen).toBeTruthy();
    expect(seen.status).toBe("requested");
    expect(seen.viewerRole).toBe("provider");

    // The requesting customer cannot confirm their own booking.
    const selfConfirm = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/confirm`,
      headers: auth(customer),
      payload: { externalReference: "SELF" }
    });
    expect(selfConfirm.statusCode).toBe(403);

    // An unrelated organization cannot confirm it either.
    const strangerConfirm = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/confirm`,
      headers: auth(stranger),
      payload: { externalReference: "STRANGER" }
    });
    expect(strangerConfirm.statusCode).toBe(403);

    // Confirmation requires a provider reference.
    const missingRef = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/confirm`,
      headers: auth(provider),
      payload: {}
    });
    expect(missingRef.statusCode).toBe(400);

    const confirmRes = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/confirm`,
      headers: auth(provider),
      payload: { externalReference: `BKG-${stamp}` }
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(JSON.parse(confirmRes.payload).status).toBe("confirmed");

    // Manual tracking is attributed to a labelled source.
    const trackingRes = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${bookingId}/tracking`,
      headers: auth(provider),
      payload: { code: "GATE-IN", label: "Entered terminal" }
    });
    expect(trackingRes.statusCode).toBe(200);
    expect(JSON.parse(trackingRes.payload).source).toBe("manual-provider");

    // The customer can read their own booking and its events.
    const detail = await app.inject({ method: "GET", url: `/api/v1/bookings/${bookingId}`, headers: auth(customer) });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.payload);
    expect(detailBody.status).toBe("confirmed");
    expect(detailBody.viewerRole).toBe("customer");
    expect(detailBody.trackingEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("survives a fresh application instance (persistence, not process memory)", async () => {
    // A second, independent app instance must see records written by the first.
    const second = await buildApp();
    await second.ready();
    try {
      const token = await register("pg-restart");
      const mine = await second.inject({ method: "GET", url: "/api/v1/companies/mine", headers: auth(token) });
      expect(mine.statusCode).toBe(200);

      const created = await second.inject({
        method: "POST",
        url: "/api/v1/companies/register",
        headers: auth(token),
        payload: { name: `PG Persist ${stamp}-${Math.floor(Math.random() * 100000)}`, type: "forwarder", country: "EG" }
      });
      const companyId = JSON.parse(created.payload).id;

      const third = await buildApp();
      await third.ready();
      try {
        const after = await third.inject({ method: "GET", url: "/api/v1/companies/mine", headers: auth(token) });
        const ids = JSON.parse(after.payload).items.map((c: any) => c.id);
        expect(ids).toContain(companyId);
      } finally {
        await third.close();
      }
    } finally {
      await second.close();
    }
  });
});

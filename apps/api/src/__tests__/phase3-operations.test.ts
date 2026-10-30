import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { runRetention } from "../documents/retention.js";

const suite = prisma ? describe : describe.skip;
let app: any;
const stamp = Date.now();

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

async function register(prefix: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email: `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7)}@naql.test`,
      password: "password123",
      displayName: prefix
    }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).token;
}

async function createCompany(token: string, prefix: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/companies/register",
    headers: auth(token),
    payload: { name: `${prefix} ${stamp}-${Math.random().toString(36).slice(2, 6)}`, type: "forwarder", country: "EG" }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).id;
}

async function createShipment(token: string, description = "Phase 3 test cargo"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/shipments",
    headers: auth(token),
    payload: {
      originPortId: "JED",
      destinationPortId: "RUH",
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription: description,
      weightKg: 120
    }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).id;
}

function minimalPdf(text = "Phase 3 invoice"): Buffer {
  const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 12 Tf 72 720 Td (${text}) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;
  return Buffer.from(body, "utf8");
}

async function createRfq(token: string, companyIds: string[], description: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/rfqs",
    headers: auth(token),
    payload: {
      origin: "Alexandria",
      destination: "Jeddah",
      mode: "SEA",
      cargoDescription: description,
      weightKg: 500,
      recipientCompanyIds: companyIds
    }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).id;
}

async function submitQuote(
  token: string,
  rfqId: string,
  companyId: string,
  amount: number
): Promise<any> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/rfqs/${rfqId}/quotes`,
    headers: auth(token),
    payload: {
      companyId,
      currency: "USD",
      transitDays: 12,
      validityUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      items: [{ label: "Ocean freight", amount, currency: "USD", included: true }]
    }
  });
  expect(res.statusCode).toBe(200);
  return json(res);
}

suite("Phase 3 operations", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("uploads, authorizes and downloads company verification documents without exposing storage keys", async () => {
    const owner = await register("p3-doc-owner");
    const stranger = await register("p3-doc-stranger");
    const companyId = await createCompany(owner, "Secure Docs");
    const pdf = minimalPdf();

    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyId}/documents`,
      headers: auth(owner),
      payload: {
        type: "commercial_register",
        filename: "commercial-register.pdf",
        contentType: "application/pdf",
        size: pdf.length,
        dataBase64: pdf.toString("base64")
      }
    });
    expect(upload.statusCode).toBe(200);
    const document = await json(upload);
    expect(document.storageKey).toBeUndefined();
    expect(document.malwareScanStatus).toBe("not_scanned");
    expect(document.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(document.hasContent).toBe(true);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyId}/documents`,
      headers: auth(owner)
    });
    expect(list.statusCode).toBe(200);
    expect((await json(list)).items).toHaveLength(1);

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyId}/documents/${document.id}/content`,
      headers: auth(owner)
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.rawPayload.equals(pdf)).toBe(true);

    const crossOrg = await app.inject({
      method: "GET",
      url: `/api/v1/companies/${companyId}/documents/${document.id}/content`,
      headers: auth(stranger)
    });
    expect(crossOrg.statusCode).toBe(404);

    const disguised = Buffer.from("MZ\u0000\u0000this is not a pdf", "utf8");
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyId}/documents`,
      headers: auth(owner),
      payload: {
        type: "commercial_register",
        filename: "evil.pdf",
        contentType: "application/pdf",
        size: disguised.length,
        dataBase64: disguised.toString("base64")
      }
    });
    expect(rejected.statusCode).toBe(415);
    expect((await json(rejected)).code).toBe("content_signature_mismatch");

    const oversized = await app.inject({
      method: "POST",
      url: `/api/v1/companies/${companyId}/documents`,
      headers: auth(owner),
      payload: {
        type: "commercial_register",
        filename: "huge.pdf",
        contentType: "application/pdf",
        size: 2 * 1024 * 1024 + 1,
        dataBase64: "AAAA"
      }
    });
    expect(oversized.statusCode).toBe(400);

    const audit = await prisma!.auditLog.findFirst({
      where: { action: "company.document.uploaded", entityId: document.id }
    });
    expect(audit).toBeTruthy();
  });

  it("authorizes shipment document bytes and rejects cross-organization downloads", async () => {
    const owner = await register("p3-ship-doc-owner");
    const rival = await register("p3-ship-doc-rival");
    const shipmentId = await createShipment(owner);
    const text = "Commercial Invoice\nInvoice No: P3-100\nCurrency: USD\nTotal: 100";
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(owner),
      payload: {
        type: "invoice",
        filename: "invoice.txt",
        contentType: "text/plain",
        size: Buffer.byteLength(text),
        dataBase64: Buffer.from(text).toString("base64")
      }
    });
    expect(upload.statusCode).toBe(200);
    const document = await json(upload);
    expect(document.malwareScanStatus).toBe("not_scanned");
    expect(document.storageKey).toBeUndefined();

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/process`,
      headers: auth(owner)
    });
    expect(first.statusCode).toBe(200);
    const firstBody = await json(first);
    expect(firstBody.status).toBe("completed");

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${document.id}/process`,
      headers: auth(owner)
    });
    expect(second.statusCode).toBe(200);
    expect((await json(second)).status).toBe("completed");
    expect(await prisma!.documentExtraction.count({ where: { documentId: document.id } })).toBe(1);

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/content`,
      headers: auth(owner)
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString("utf8")).toBe(text);

    const crossOrg = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${document.id}/content`,
      headers: auth(rival)
    });
    expect(crossOrg.statusCode).toBe(404);
  });

  it("accepts exactly one quote under concurrency, is retry-safe, and records booking decisions", async () => {
    const customer = await register("p3-customer");
    const providerA = await register("p3-provider-a");
    const providerB = await register("p3-provider-b");
    const companyA = await createCompany(providerA, "Provider A");
    const companyB = await createCompany(providerB, "Provider B");
    const rfqId = await createRfq(customer, [companyA, companyB], "Concurrent acceptance cargo");
    const quoteA = await submitQuote(providerA, rfqId, companyA, 1000);
    const quoteB = await submitQuote(providerB, rfqId, companyB, 950);

    const notifications = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: auth(customer)
    });
    expect(notifications.statusCode).toBe(200);
    const received = (await json(notifications)).items.find(
      (item: any) => item.type === "QUOTATION_RECEIVED" && item.entityId === rfqId
    );
    expect(received).toBeTruthy();
    expect(received.read).toBe(false);

    const read = await app.inject({
      method: "PATCH",
      url: `/api/v1/notifications/${received.id}/read`,
      headers: auth(customer)
    });
    expect(read.statusCode).toBe(200);
    expect((await json(read)).read).toBe(true);

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfqId}/accept`,
        headers: auth(customer),
        payload: { quoteId: quoteA.id }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfqId}/accept`,
        headers: auth(customer),
        payload: { quoteId: quoteB.id }
      })
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const accepted = first.statusCode === 200 ? first : second;
    const acceptedBody = await json(accepted);
    expect(acceptedBody.status).toBe("requested");

    const rfq = await prisma!.rfq.findUnique({ where: { id: rfqId }, include: { quotes: true } });
    expect(rfq?.status).toBe("accepted");
    const acceptedQuotes = rfq!.quotes.filter((quote) => quote.status === "accepted");
    expect(acceptedQuotes).toHaveLength(1);
    expect(acceptedQuotes[0].id).toBe(acceptedBody.quoteId);
    const bookings = await prisma!.bookingRequest.findMany({ where: { rfqId } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0].quoteId).toBe(acceptedQuotes[0].id);

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: auth(customer),
      payload: { quoteId: acceptedBody.quoteId }
    });
    expect(retry.statusCode).toBe(200);
    const retried = await json(retry);
    expect(retried.alreadyAccepted).toBe(true);
    expect(retried.id).toBe(acceptedBody.id);
    expect(await prisma!.bookingRequest.count({ where: { rfqId } })).toBe(1);

    const winnerToken = acceptedBody.quoteId === quoteA.id ? providerA : providerB;
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${acceptedBody.id}/confirm`,
      headers: auth(winnerToken),
      payload: { externalReference: "P3-CONF-1" }
    });
    expect(confirmed.statusCode).toBe(200);
    const confirmedBody = await json(confirmed);
    expect(confirmedBody.status).toBe("confirmed");
    expect(confirmedBody.decidedAt).toBeTruthy();
    expect(confirmedBody.decidedByUserId).toBeTruthy();

    const doubleConfirm = await app.inject({
      method: "POST",
      url: `/api/v1/bookings/${acceptedBody.id}/confirm`,
      headers: auth(winnerToken),
      payload: { externalReference: "P3-CONF-2" }
    });
    expect(doubleConfirm.statusCode).toBe(409);

    const bookingNotification = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: auth(customer)
    });
    expect(
      (await json(bookingNotification)).items.some(
        (item: any) => item.type === "BOOKING_CONFIRMED" && item.entityId === acceptedBody.id
      )
    ).toBe(true);
  });

  it("rejects expired quotes and keeps the RFQ open", async () => {
    const customer = await register("p3-exp-customer");
    const provider = await register("p3-exp-provider");
    const companyId = await createCompany(provider, "Expired Provider");
    const rfqId = await createRfq(customer, [companyId], "Expired quote cargo");
    const quote = await submitQuote(provider, rfqId, companyId, 700);

    await prisma!.quote.update({
      where: { id: quote.id },
      data: { validityUntil: new Date(Date.now() - 60_000) }
    });
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: auth(customer),
      payload: { quoteId: quote.id }
    });
    expect(accept.statusCode).toBe(409);
    expect((await json(accept)).code).toBe("quote_expired");
    expect(await prisma!.bookingRequest.count({ where: { rfqId } })).toBe(0);
    expect((await prisma!.rfq.findUnique({ where: { id: rfqId } }))?.status).toBe("submitted");

    const stranger = await register("p3-exp-stranger");
    const crossOrg = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: auth(stranger),
      payload: { quoteId: quote.id }
    });
    expect([403, 404]).toContain(crossOrg.statusCode);
  });

  it("lets only the owning provider withdraw a submitted quote and blocks its acceptance", async () => {
    const customer = await register("p3-wd-customer");
    const provider = await register("p3-wd-provider");
    const rival = await register("p3-wd-rival");
    const companyId = await createCompany(provider, "Withdraw Provider");
    const rfqId = await createRfq(customer, [companyId], "Withdraw quote cargo");
    const quote = await submitQuote(provider, rfqId, companyId, 810);

    const crossOrg = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes/${quote.id}/withdraw`,
      headers: auth(rival)
    });
    expect(crossOrg.statusCode).toBe(403);

    const withdraw = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes/${quote.id}/withdraw`,
      headers: auth(provider)
    });
    expect(withdraw.statusCode).toBe(200);
    expect((await json(withdraw)).status).toBe("withdrawn");

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes/${quote.id}/withdraw`,
      headers: auth(provider)
    });
    expect(retry.statusCode).toBe(200);
    expect((await json(retry)).alreadyWithdrawn).toBe(true);

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/accept`,
      headers: auth(customer),
      payload: { quoteId: quote.id }
    });
    expect(accept.statusCode).toBe(409);
    expect((await json(accept)).code).toBe("quote_not_acceptable");
    expect(await prisma!.bookingRequest.count({ where: { rfqId } })).toBe(0);

    const notification = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: auth(customer)
    });
    expect(
      (await json(notification)).items.some(
        (item: any) => item.type === "QUOTATION_WITHDRAWN" && item.entityId === quote.id
      )
    ).toBe(true);
  });

  it("preserves quote revisions and serializes provider resubmissions", async () => {
    const customer = await register("p4-revision-customer");
    const provider = await register("p4-revision-provider");
    const companyId = await createCompany(provider, "Revision Provider");
    const rfqId = await createRfq(customer, [companyId], "Quote revision cargo");
    const original = await submitQuote(provider, rfqId, companyId, 900);

    const withdrawn = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes/${original.id}/withdraw`,
      headers: auth(provider)
    });
    expect(withdrawn.statusCode).toBe(200);

    const resubmitted = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: auth(provider),
      payload: {
        companyId,
        currency: "USD",
        transitDays: 10,
        validityUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        items: [{ label: "Revised freight", amount: 950, currency: "USD" }]
      }
    });
    expect(resubmitted.statusCode).toBe(200);
    const revised = await json(resubmitted);
    expect(revised.id).not.toBe(original.id);
    expect((await prisma!.quote.findUnique({ where: { id: original.id } }))?.status).toBe("withdrawn");

    const duplicateActive = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: auth(provider),
      payload: {
        companyId,
        currency: "USD",
        transitDays: 8,
        validityUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        items: [{ label: "Another offer", amount: 1000, currency: "USD" }]
      }
    });
    expect(duplicateActive.statusCode).toBe(409);
    expect((await json(duplicateActive)).code).toBe("quote_already_submitted");

    await prisma!.quote.update({
      where: { id: revised.id },
      data: { validityUntil: new Date(Date.now() - 60_000) }
    });
    const afterExpiry = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes`,
      headers: auth(provider),
      payload: {
        companyId,
        currency: "USD",
        transitDays: 7,
        validityUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        items: [{ label: "Current offer", amount: 980, currency: "USD" }]
      }
    });
    expect(afterExpiry.statusCode).toBe(200);
    expect((await prisma!.quote.findUnique({ where: { id: revised.id } }))?.status).toBe("expired");
    const currentQuote = await json(afterExpiry);
    const withdrawCurrent = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfqId}/quotes/${currentQuote.id}/withdraw`,
      headers: auth(provider)
    });
    expect(withdrawCurrent.statusCode).toBe(200);

    const concurrentPayload = {
      companyId,
      currency: "USD",
      transitDays: 6,
      validityUntil: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      items: [{ label: "Concurrent offer", amount: 970, currency: "USD" }]
    };
    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfqId}/quotes`,
        headers: auth(provider),
        payload: concurrentPayload
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfqId}/quotes`,
        headers: auth(provider),
        payload: concurrentPayload
      })
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  });

  it("creates one shipment at quote acceptance and links it to the RFQ, booking, and awarded provider", async () => {
    const customer = await register("p4-link-customer");
    const provider = await register("p4-link-provider");
    const companyId = await createCompany(provider, "Linked Shipment Provider");
    const origin = await prisma!.port.upsert({
      where: { code: "P4-ALY" },
      create: {
        code: "P4-ALY",
        name: "Phase 4 Alexandria Port",
        country: "EG",
        latitude: 31.2,
        longitude: 29.9,
        type: "seaport",
        source: "isolated phase 4 test fixture",
        verificationStatus: "unverified"
      },
      update: {}
    });
    const destination = await prisma!.port.upsert({
      where: { code: "P4-JED" },
      create: {
        code: "P4-JED",
        name: "Phase 4 Jeddah Port",
        country: "SA",
        latitude: 21.5,
        longitude: 39.2,
        type: "seaport",
        source: "isolated phase 4 test fixture",
        verificationStatus: "unverified"
      },
      update: {}
    });

    const rfqResponse = await app.inject({
      method: "POST",
      url: "/api/v1/rfqs",
      headers: auth(customer),
      payload: {
        origin: origin.name,
        destination: destination.name,
        originPortId: origin.id,
        destinationPortId: destination.id,
        mode: "SEA",
        incoterm: "FOB",
        cargoDescription: "Linked shipment cargo",
        weightKg: 1200,
        recipientCompanyIds: [companyId]
      }
    });
    expect(rfqResponse.statusCode).toBe(200);
    const rfq = await json(rfqResponse);
    const quote = await submitQuote(provider, rfq.id, companyId, 1500);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.id}/accept`,
      headers: auth(customer),
      payload: { quoteId: quote.id }
    });
    expect(accepted.statusCode).toBe(200);
    const booking = await json(accepted);
    expect(booking.shipmentId).toBeTruthy();

    const linkedRfq = await prisma!.rfq.findUnique({ where: { id: rfq.id } });
    const shipment = await prisma!.shipment.findUnique({
      where: { id: booking.shipmentId },
      include: { parties: true }
    });
    expect(linkedRfq?.shipmentId).toBe(booking.shipmentId);
    expect(shipment?.organizationId).toBe(linkedRfq?.organizationId);
    expect(shipment?.status).toBe("QUOTED");
    expect(shipment?.parties.some((party) => party.companyId === companyId && party.canView)).toBe(true);
    expect(await prisma!.bookingRequest.count({ where: { rfqId: rfq.id, shipmentId: booking.shipmentId } })).toBe(1);

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.id}/accept`,
      headers: auth(customer),
      payload: { quoteId: quote.id }
    });
    expect(retry.statusCode).toBe(200);
    expect((await json(retry)).shipmentId).toBe(booking.shipmentId);
    expect(await prisma!.shipment.count({ where: { id: booking.shipmentId } })).toBe(1);

    const ownerRfqView = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.id}`,
      headers: auth(customer)
    });
    expect(ownerRfqView.statusCode).toBe(200);
    const ownerRfq = await json(ownerRfqView);
    expect(ownerRfq.viewerRole).toBe("owner");
    expect(ownerRfq.bookings).toHaveLength(1);
    expect(ownerRfq.bookings[0].shipmentId).toBe(booking.shipmentId);
    expect(
      ownerRfq.quotes.some(
        (item: any) => item.id === quote.id && item.company?.name?.startsWith("Linked Shipment Provider")
      )
    ).toBe(true);

    const providerRfqView = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.id}`,
      headers: auth(provider)
    });
    expect(providerRfqView.statusCode).toBe(200);
    const providerRfq = await json(providerRfqView);
    expect(providerRfq.viewerRole).toBe("provider");
    expect(providerRfq.bookings).toBeUndefined();
    expect(providerRfq.quotes.every((item: any) => item.companyId === companyId)).toBe(true);

    const providerView = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${booking.shipmentId}`,
      headers: auth(provider)
    });
    expect(providerView.statusCode).toBe(200);
  });

  it("records idempotent shipment milestones with validated transitions and honest live-tracking status", async () => {
    const owner = await register("p3-event-owner");
    const rival = await register("p3-event-rival");
    const shipmentId = await createShipment(owner, "Milestone cargo");

    const first = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: {
        code: "BOOKING_CONFIRMED",
        idempotencyKey: "P3-EVENT-BOOK-1",
        occurredAt: new Date().toISOString()
      }
    });
    expect(first.statusCode).toBe(200);
    const firstEvent = await json(first);
    expect(firstEvent.idempotent).toBe(false);

    const retry = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: {
        code: "BOOKING_CONFIRMED",
        idempotencyKey: "P3-EVENT-BOOK-1",
        occurredAt: new Date().toISOString()
      }
    });
    expect(retry.statusCode).toBe(200);
    const retried = await json(retry);
    expect(retried.idempotent).toBe(true);
    expect(retried.id).toBe(firstEvent.id);
    expect(await prisma!.shipmentEvent.count({ where: { shipmentId } })).toBe(1);
    expect((await prisma!.shipment.findUnique({ where: { id: shipmentId } }))?.status).toBe("BOOKED");

    const departed = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: { code: "DEPARTED", idempotencyKey: "P3-EVENT-DEPART-1" }
    });
    expect(departed.statusCode).toBe(200);
    expect((await prisma!.shipment.findUnique({ where: { id: shipmentId } }))?.status).toBe("IN_TRANSIT");

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: { code: "DEPARTED", idempotencyKey: "P3-EVENT-DEPART-2" }
    });
    expect(invalid.statusCode).toBe(409);
    expect((await json(invalid)).code).toBe("invalid_shipment_transition");

    const future = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: { code: "ARRIVED", occurredAt: new Date(Date.now() + 3_600_000).toISOString() }
    });
    expect(future.statusCode).toBe(400);
    expect((await json(future)).code).toBe("future_event_timestamp");

    const delayed = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: { code: "DELAYED", idempotencyKey: "P3-EVENT-DELAY-1" }
    });
    expect(delayed.statusCode).toBe(200);
    expect((await prisma!.shipment.findUnique({ where: { id: shipmentId } }))?.status).toBe("EXCEPTION");

    const riskRefresh = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/intelligence/refresh`,
      headers: auth(owner)
    });
    expect(riskRefresh.statusCode).toBe(200);
    const riskBody = await json(riskRefresh);
    expect(["high", "critical"]).toContain(riskBody.risk.category);

    const riskNotifications = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50&unreadOnly=true",
      headers: auth(owner)
    });
    expect(riskNotifications.statusCode).toBe(200);
    expect(
      (await json(riskNotifications)).items.filter((item: any) => item.type === "RISK_ALERT").length
    ).toBeGreaterThanOrEqual(2);

    const crossOrg = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(rival),
      payload: { code: "IN_TRANSIT" }
    });
    expect(crossOrg.statusCode).toBe(404);

    const tracking = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/tracking`,
      headers: auth(owner)
    });
    expect(tracking.statusCode).toBe(200);
    const trackingBody = await json(tracking);
    expect(trackingBody.liveTracking.available).toBe(false);
    expect(trackingBody.liveTracking.code).toBe("live_tracking_unavailable");
    expect(trackingBody.events).toHaveLength(3);

    const external = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner),
      payload: { code: "IN_TRANSIT", source: "external_verified" }
    });
    expect(external.statusCode).toBe(503);
    expect((await json(external)).code).toBe("live_tracking_integration_unavailable");

    const events = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/events`,
      headers: auth(owner)
    });
    expect(events.statusCode).toBe(200);
    expect((await json(events)).items.map((event: any) => event.code)).toEqual([
      "BOOKING_CONFIRMED",
      "DEPARTED",
      "DELAYED"
    ]);
  });

  it("dry-runs retention by default and soft-deletes plus removes bytes only when applied", async () => {
    const owner = await register("p3-retention-owner");
    const shipmentId = await createShipment(owner, "Retention cargo");
    const text = "Retention test document";
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: auth(owner),
      payload: {
        type: "other",
        filename: "retention.txt",
        contentType: "text/plain",
        size: Buffer.byteLength(text),
        dataBase64: Buffer.from(text).toString("base64")
      }
    });
    expect(upload.statusCode).toBe(200);
    const documentId = (await json(upload)).id;
    await prisma!.document.update({
      where: { id: documentId },
      data: { retentionUntil: new Date(Date.now() - 60_000) }
    });

    const dryRun = await runRetention({ apply: false });
    expect(dryRun.mode).toBe("dry_run");
    expect(dryRun.documents.eligible).toBeGreaterThanOrEqual(1);
    expect(dryRun.documents.deleted).toBe(0);
    expect((await prisma!.document.findUnique({ where: { id: documentId } }))?.deletedAt).toBeNull();

    const applied = await runRetention({ apply: true });
    expect(applied.documents.deleted).toBeGreaterThanOrEqual(1);
    const deleted = await prisma!.document.findUnique({ where: { id: documentId } });
    expect(deleted?.deletedAt).toBeTruthy();
    expect(deleted?.status).toBe("retention_expired");

    const download = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/content`,
      headers: auth(owner)
    });
    expect(download.statusCode).toBe(404);
  });
});

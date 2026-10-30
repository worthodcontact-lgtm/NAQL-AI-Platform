import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

let app: any;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function register(email: string) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: "password123", displayName: "Tester" } });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.payload).token as string;
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n%%EOF");

describe("authorization and tenant isolation", () => {
  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/shipments" });
    expect(res.statusCode).toBe(401);
  });

  it("prevents cross-tenant shipment access", async () => {
    const emailA = `a-${Date.now()}@example.com`;
    const emailB = `b-${Date.now()}@example.com`;
    const tokenA = await register(emailA);
    const tokenB = await register(emailB);

    const created = await app.inject({
      method: "POST", url: "/api/v1/shipments",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { originPortId: "JED", destinationPortId: "RUH", mode: "SEA", incoterm: "FOB", cargoDescription: "coils", weightKg: 1000 }
    });
    expect(created.statusCode).toBe(200);
    const shipmentId = JSON.parse(created.payload).id;

    const listB = await app.inject({ method: "GET", url: "/api/v1/shipments", headers: { authorization: `Bearer ${tokenB}` } });
    expect(JSON.parse(listB.payload).items).toHaveLength(0);

    const directB = await app.inject({ method: "GET", url: `/api/v1/shipments/${shipmentId}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(directB.statusCode).toBe(404);
  });

  it("runs quotation workflow with validation", async () => {
    const email = `q-${Date.now()}@example.com`;
    const token = await register(email);
    const created = await app.inject({
      method: "POST", url: "/api/v1/shipments",
      headers: { authorization: `Bearer ${token}` },
      payload: { originPortId: "JED", destinationPortId: "RUH", mode: "SEA", incoterm: "FOB", cargoDescription: "parts", weightKg: 500 }
    });
    const shipmentId = JSON.parse(created.payload).id;

    const quoteRes = await app.inject({
      method: "POST", url: "/api/v1/quotations",
      headers: { authorization: `Bearer ${token}` },
      payload: { shipmentId }
    });
    expect(quoteRes.statusCode).toBe(200);
    const quoteId = JSON.parse(quoteRes.payload).id;

    // The requesting customer must NOT be able to write an offer onto its own request.
    const selfOffer = await app.inject({
      method: "POST", url: `/api/v1/quotations/${quoteId}/offers`,
      headers: { authorization: `Bearer ${token}` },
      payload: { providerId: "provider-1", currency: "USD", amount: 1200, transitDays: 14, validityUntil: new Date(Date.now() + 86400000).toISOString() }
    });
    expect(selfOffer.statusCode).toBe(403);

    // A provider organization that actually owns the company submits the offer.
    const providerToken = await register(`qp-${Date.now()}@example.com`);
    const companyRes = await app.inject({
      method: "POST", url: "/api/v1/companies/register",
      headers: { authorization: `Bearer ${providerToken}` },
      payload: { name: `Legacy Provider ${Date.now()}`, type: "forwarder", country: "EG" }
    });
    expect(companyRes.statusCode).toBe(200);
    const companyId = JSON.parse(companyRes.payload).id;

    // Per-shipment collaboration: the provider must be an invited party with the
    // quote flag. Knowing the quotation id alone is not enough.
    if (prisma) {
      const partyRes = await app.inject({
        method: "POST",
        url: `/api/v1/shipments/${shipmentId}/parties`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          companyId,
          partyRole: "FREIGHT_FORWARDER",
          permissions: { canView: true, canQuote: true, canViewFinancials: true }
        }
      });
      expect(partyRes.statusCode).toBe(200);
    }

    // The provider cannot forge an offer under a company it does not own.
    const forgedOffer = await app.inject({
      method: "POST", url: `/api/v1/quotations/${quoteId}/offers`,
      headers: { authorization: `Bearer ${providerToken}` },
      payload: { providerId: "someone-elses-company", currency: "USD", amount: 1, transitDays: 1, validityUntil: new Date(Date.now() + 86400000).toISOString() }
    });
    expect(forgedOffer.statusCode).toBe(403);

    const offerRes = await app.inject({
      method: "POST", url: `/api/v1/quotations/${quoteId}/offers`,
      headers: { authorization: `Bearer ${providerToken}` },
      payload: { providerId: companyId, currency: "USD", amount: 1200, transitDays: 14, validityUntil: new Date(Date.now() + 86400000).toISOString() }
    });
    expect(offerRes.statusCode).toBe(200);
    const offerId = JSON.parse(offerRes.payload).id;

    const awardRes = await app.inject({
      method: "POST", url: `/api/v1/quotations/${quoteId}/award`,
      headers: { authorization: `Bearer ${token}` },
      payload: { offerId }
    });
    expect(awardRes.statusCode).toBe(200);
    expect(JSON.parse(awardRes.payload).status).toBe("awarded");
  });

  it("rejects invalid landed cost input", async () => {
    const email = `lc-${Date.now()}@example.com`;
    const token = await register(email);
    const res = await app.inject({
      method: "POST", url: "/api/v1/costs/landed-cost",
      headers: { authorization: `Bearer ${token}` },
      payload: { productCost: -1, freight: 0, insurance: 0, customsDutyRate: 0, taxRate: 0, fees: 0, currency: "USD" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("marks incomplete landed cost inputs unknown and rejects mixed currencies", async () => {
    const email = `lc-incomplete-${Date.now()}@example.com`;
    const token = await register(email);
    const incomplete = await app.inject({
      method: "POST", url: "/api/v1/costs/landed-cost",
      headers: { authorization: `Bearer ${token}` },
      payload: { productCost: 1000, freight: 200, currency: "USD" }
    });
    expect(incomplete.statusCode).toBe(200);
    const assessment = JSON.parse(incomplete.payload);
    expect(assessment.status).toBe("incomplete");
    expect(assessment.total).toBeNull();
    expect(assessment.provenance.fees.inclusion).toBe("unknown");

    const mismatch = await app.inject({
      method: "POST", url: "/api/v1/costs/landed-cost",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        productCost: 1000, freight: 200, insurance: 30, customsDutyRate: 0.05,
        taxRate: 0.15, fees: 20, currency: "USD", componentCurrencies: { freight: "EGP" }
      }
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it.skipIf(!prisma)("processes a text invoice through the real deterministic extractor", async () => {
    const email = `d-${Date.now()}@example.com`;
    const token = await register(email);
    const created = await app.inject({
      method: "POST", url: "/api/v1/shipments",
      headers: { authorization: `Bearer ${token}` },
      payload: { originPortId: "JED", destinationPortId: "RUH", mode: "SEA", incoterm: "FOB", cargoDescription: "docs", weightKg: 100 }
    });
    const shipmentId = JSON.parse(created.payload).id;

    const invoice = [
      "Commercial Invoice",
      "Invoice No: INV-100",
      "Date: 2026-10-01",
      "Currency: USD",
      "Total: 100.00"
    ].join("\n");
    const upload = await app.inject({
      method: "POST", url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: "invoice",
        filename: "invoice.txt",
        contentType: "text/plain",
        size: Buffer.byteLength(invoice),
        dataBase64: Buffer.from(invoice).toString("base64")
      }
    });
    expect(upload.statusCode).toBe(200);
    const docId = JSON.parse(upload.payload).id;
    expect(JSON.parse(upload.payload).storageKey).toBeUndefined();

    const processing = await app.inject({
      method: "POST", url: `/api/v1/documents/${docId}/process`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(processing.statusCode).toBe(200);
    const body = JSON.parse(processing.payload);
    expect(body.status).toBe("completed");
    expect(body.documentType).toBe("commercial_invoice");
    expect(body.malwareScanStatus).toBe("not_scanned");
    expect(body.fields.some((field: any) => field.key === "invoice_number" && field.value === "INV-100")).toBe(true);

    const extraction = await app.inject({
      method: "GET", url: `/api/v1/documents/${docId}/extraction`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(extraction.statusCode).toBe(200);
    expect(JSON.parse(extraction.payload).fields.length).toBeGreaterThan(0);
  });

  it("rejects path traversal in document filenames before storage is touched", async () => {
    const email = `doc-path-${Date.now()}@example.com`;
    const token = await register(email);
    const created = await app.inject({
      method: "POST", url: "/api/v1/shipments",
      headers: { authorization: `Bearer ${token}` },
      payload: { originPortId: "JED", destinationPortId: "RUH", mode: "SEA", incoterm: "FOB", cargoDescription: "path test", weightKg: 100 }
    });
    const shipmentId = JSON.parse(created.payload).id;

    for (const filename of ["../escape.pdf", "..\\escape.pdf", "/etc/passwd", "C:\\Windows\\win.ini", "folder/invoice.pdf"]) {
      const res = await app.inject({
        method: "POST", url: `/api/v1/shipments/${shipmentId}/documents`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          type: "invoice",
          filename,
          contentType: "application/pdf",
          size: 3,
          dataBase64: Buffer.from("abc").toString("base64")
        }
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).code).toBe("invalid_filename");
    }

    const valid = await app.inject({
      method: "POST", url: `/api/v1/shipments/${shipmentId}/documents`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: "invoice",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: PDF_BYTES.length,
        dataBase64: PDF_BYTES.toString("base64")
      }
    });
    expect(valid.statusCode).toBe(200);
    expect(JSON.parse(valid.payload).storageKey).toBeUndefined();
  });

  it("returns AI copilot fallback when provider unavailable", async () => {
    const email = `ai-${Date.now()}@example.com`;
    const token = await register(email);
    const res = await app.inject({
      method: "POST", url: "/api/v1/ai/copilot",
      headers: { authorization: `Bearer ${token}` },
      payload: { question: "Hello" }
    });
    const body = JSON.parse(res.payload);
    expect(res.statusCode).toBe(200);
    expect(body.providerAvailable).toBe(false);
  });
});

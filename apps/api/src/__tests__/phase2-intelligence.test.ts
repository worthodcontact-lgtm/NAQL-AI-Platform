import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

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

async function createShipment(token: string, weightKg = 100): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/shipments",
    headers: auth(token),
    payload: {
      originPortId: "JED",
      destinationPortId: "RUH",
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription: "Phase 2 test cargo",
      weightKg
    }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).id;
}

async function uploadText(token: string, shipmentId: string, filename: string, text: string) {
  const upload = await app.inject({
    method: "POST",
    url: `/api/v1/shipments/${shipmentId}/documents`,
    headers: auth(token),
    payload: {
      type: filename.includes("packing") ? "packing_list" : "invoice",
      filename,
      contentType: "text/plain",
      size: Buffer.byteLength(text),
      dataBase64: Buffer.from(text).toString("base64")
    }
  });
  expect(upload.statusCode).toBe(200);
  const documentId = (await json(upload)).id;
  const processed = await app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/process`,
    headers: auth(token)
  });
  expect(processed.statusCode).toBe(200);
  return { documentId, processing: await json(processed) };
}

suite("Phase 2 intelligence integration", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("processes, validates, retrieves and isolates a shipment end to end", async () => {
    const owner = await register("phase2-owner");
    const rival = await register("phase2-rival");
    const shipmentId = await createShipment(owner, 100);
    const rivalShipmentId = await createShipment(rival, 50);

    const invoiceText = [
      "Commercial Invoice",
      "Invoice No: INV-2-100",
      "Shipment Reference: NAQ-2-100",
      "Date: 2026-10-01",
      "Currency: USD",
      "Subtotal: 100",
      "Tax: 10",
      "Total: 110"
    ].join("\n");
    const invoice = await uploadText(owner, shipmentId, "invoice.txt", invoiceText);
    expect(invoice.processing.status).toBe("completed");
    expect(invoice.processing.documentType).toBe("commercial_invoice");
    expect(invoice.processing.fields.some((field: any) => field.key === "invoice_number")).toBe(true);
    expect(invoice.processing.malwareScanStatus).toBe("not_scanned");

    const packingText = [
      "Packing List",
      "Date: 2026-10-02",
      "Packages: 4",
      "Gross Weight: 150 kg"
    ].join("\n");
    const packing = await uploadText(owner, shipmentId, "packing.txt", packingText);
    expect(packing.processing.status).toBe("completed");
    expect(packing.processing.documentType).toBe("packing_list");

    const consistency = await app.inject({
      method: "POST",
      url: `/api/v1/shipments/${shipmentId}/consistency`,
      headers: auth(owner)
    });
    expect(consistency.statusCode).toBe(200);
    const findings = (await json(consistency)).findings;
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.some((finding: any) => finding.code === "SHIPMENT_WEIGHT_MISMATCH")).toBe(true);

    const persistedFindings = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/consistency`,
      headers: auth(owner)
    });
    expect(persistedFindings.statusCode).toBe(200);
    expect((await json(persistedFindings)).findings.length).toBeGreaterThan(0);

    // Authorized retrieval includes the shipment and its documents.
    const retrieval = await app.inject({
      method: "POST",
      url: "/api/v1/ai/retrieval/search",
      headers: auth(owner),
      payload: { query: "invoice packing weight", shipmentId }
    });
    expect(retrieval.statusCode).toBe(200);
    const retrievalBody = await json(retrieval);
    expect(retrievalBody.empty).toBe(false);
    expect(retrievalBody.method).toBe("deterministic-keyword-v1");
    expect(retrievalBody.sources.some((source: any) => source.type === "document" && source.documentId === invoice.documentId)).toBe(true);

    // A rival organization cannot retrieve the owner's shipment.
    const rivalRetrieval = await app.inject({
      method: "POST",
      url: "/api/v1/ai/retrieval/search",
      headers: auth(rival),
      payload: { query: "invoice", shipmentId }
    });
    expect(rivalRetrieval.statusCode).toBe(200);
    const rivalBody = await json(rivalRetrieval);
    expect(rivalBody.empty).toBe(true);
    expect(rivalBody.sources).toEqual([]);

    const rivalGlobal = await app.inject({
      method: "POST",
      url: "/api/v1/ai/retrieval/search",
      headers: auth(rival),
      payload: { query: "INV-2-100" }
    });
    const rivalGlobalBody = await json(rivalGlobal);
    expect(rivalGlobalBody.sources.some((source: any) => source.id === shipmentId || source.documentId === invoice.documentId)).toBe(false);

    // Copilot uses only authorized context and persists the conversation.
    const copilot = await app.inject({
      method: "POST",
      url: "/api/v1/ai/copilot",
      headers: auth(owner),
      payload: { message: "What documents do I have for this shipment?", shipmentId }
    });
    expect(copilot.statusCode).toBe(200);
    const copilotBody = await json(copilot);
    expect(copilotBody.providerAvailable).toBe(false);
    expect(copilotBody.status).toBe("degraded");
    expect(copilotBody.sources.length).toBeGreaterThan(0);
    expect(copilotBody.conversationId).toBeTruthy();
    expect(copilotBody.persisted).toBe(true);

    const rivalConversation = await app.inject({
      method: "GET",
      url: `/api/v1/ai/conversations/${copilotBody.conversationId}`,
      headers: auth(rival)
    });
    expect(rivalConversation.statusCode).toBe(404);

    const rivalCopilot = await app.inject({
      method: "POST",
      url: "/api/v1/ai/copilot",
      headers: auth(rival),
      payload: { message: "Summarize this shipment", shipmentId }
    });
    expect(rivalCopilot.statusCode).toBe(200);
    const rivalCopilotBody = await json(rivalCopilot);
    expect(rivalCopilotBody.sources).toEqual([]);
    expect(rivalCopilotBody.answer.toLowerCase()).toContain("could not find authorized");

    // Extraction of a private owner document is not readable by the rival.
    const rivalExtraction = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${invoice.documentId}/extraction`,
      headers: auth(rival)
    });
    expect(rivalExtraction.statusCode).toBe(404);

    // Risk and delay are persisted and honest about the missing ETA.
    const intelligence = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/intelligence`,
      headers: auth(owner)
    });
    expect(intelligence.statusCode).toBe(200);
    const intelligenceBody = await json(intelligence);
    expect(intelligenceBody.risk.method).toBe("deterministic-rules-v1");
    expect(intelligenceBody.risk.dataCompleteness).toBeGreaterThan(0);
    expect(intelligenceBody.delay.status).toBe("insufficient_data");
    expect(intelligenceBody.delay.estimatedDelayDays).toBeNull();
    expect(intelligenceBody.limitations.length).toBeGreaterThan(0);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/intelligence/history`,
      headers: auth(owner)
    });
    expect(history.statusCode).toBe(200);
    expect((await json(history)).risk.length).toBeGreaterThan(0);
    expect((await json(history)).delay.length).toBeGreaterThan(0);

    const rivalIntelligence = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${shipmentId}/intelligence`,
      headers: auth(rival)
    });
    expect(rivalIntelligence.statusCode).toBe(404);

    // The rival's own shipment remains accessible.
    const ownIntelligence = await app.inject({
      method: "GET",
      url: `/api/v1/shipments/${rivalShipmentId}/intelligence`,
      headers: auth(rival)
    });
    expect(ownIntelligence.statusCode).toBe(200);
  });
});

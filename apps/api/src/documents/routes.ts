import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { storageAdapter } from "../storage/adapter.js";
import { env, AI_REQUEST_TIMEOUT_MS } from "../config/env.js";

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/csv",
  "application/json",
  "application/xml",
  "text/plain"
]);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

type DevDocument = {
  id: string;
  shipmentId: string;
  organizationId: string;
  type: string;
  filename: string;
  contentType: string;
  size: number;
  storageKey: string;
  status: string;
  validation: string | null;
  uploadedAt: string;
};

const devDocuments: DevDocument[] = [];

function notFound(reply: any) { return reply.code(404).send({ error: "Not found" }); }
function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

async function shipmentForUser(id: string, organizationId: string) {
  if (prisma) {
    const shipment = await (prisma as any).shipment.findUnique({ where: { id } });
    if (!shipment || shipment.organizationId !== organizationId) return null;
    return shipment;
  }
  return { id, organizationId };
}

export async function registerDocumentRoutes(app: FastifyInstance) {
  const uploadSchema = z.object({
    shipmentId: z.string().min(1),
    type: z.string().min(1),
    filename: z.string().min(1),
    contentType: z.string().min(1),
    size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    dataBase64: z.string().optional()
  });

  app.post("/api/v1/shipments/:id/documents", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id: shipmentId } = request.params as { id: string };
    const shipment = await shipmentForUser(shipmentId, user.organizationId);
    if (!shipment) return notFound(reply);

    const parsed = uploadSchema.safeParse({ ...(request.body as any), shipmentId });
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const input = parsed.data;

    if (input.shipmentId !== shipmentId) return reply.code(400).send({ error: "Shipment mismatch" });
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
      return reply.code(415).send({ error: "Unsupported content type", allowed: [...ALLOWED_CONTENT_TYPES] });
    }

    let data: Buffer | undefined;
    if (input.dataBase64) {
      try { data = Buffer.from(input.dataBase64, "base64"); } catch { return reply.code(400).send({ error: "Invalid base64 payload" }); }
      if (data.length !== input.size) return reply.code(400).send({ error: "Declared size does not match payload" });
      if (data.length > MAX_UPLOAD_BYTES) return reply.code(413).send({ error: "Payload too large" });
    }

    const storageKey = `shipments/${shipmentId}/documents/${Date.now()}-${input.filename}`;
    if (data) await storageAdapter.put(storageKey, data, input.contentType);

    if (prisma) {
      const doc = await (prisma as any).document.create({
        data: {
          shipmentId,
          type: input.type,
          filename: input.filename,
          storageKey,
          status: "uploaded",
          validation: null
        }
      });
      return doc;
    }

    const doc: DevDocument = {
      id: `dev-doc-${devDocuments.length + 1}`,
      shipmentId,
      organizationId: user.organizationId,
      type: input.type,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      storageKey,
      status: "uploaded",
      validation: null,
      uploadedAt: new Date().toISOString()
    };
    devDocuments.push(doc);
    return { ...doc, devFallback: true, storageMode: "memory" };
  });

  app.get("/api/v1/documents", { onRequest: [app.authenticate] }, async (request) => {
    const user = getAuthUser(request);
    const { shipmentId } = request.query as { shipmentId?: string };
    if (prisma) {
      const where: any = shipmentId ? { shipmentId } : {};
      const docs = await (prisma as any).document.findMany({ where, include: { shipment: true }, orderBy: { uploadedAt: "desc" }, take: 200 });
      const filtered = docs.filter((d: any) => d.shipment?.organizationId === user.organizationId);
      return { items: filtered };
    }
    const filtered = devDocuments.filter((d) => d.organizationId === user.organizationId && (!shipmentId || d.shipmentId === shipmentId));
    return { items: filtered, devFallback: true };
  });

  app.post("/api/v1/documents/:id/validate", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };

    if (prisma) {
      const doc = await (prisma as any).document.findUnique({ where: { id }, include: { shipment: true } });
      if (!doc || doc.shipment?.organizationId !== user.organizationId) return notFound(reply);
      let aiResult: any = null;
      let providerAvailable = true;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
        const res = await fetch(`${env.AI_SERVICE_URL}/documents/validate`, { method: "POST", signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
        aiResult = await res.json();
      } catch (error) {
        providerAvailable = false;
        aiResult = { issues: ["AI provider unavailable; deterministic extraction not performed."], extractedFields: {} };
      }
      const updated = await (prisma as any).document.update({
        where: { id },
        data: { status: providerAvailable ? "validated" : "upload-only", validation: JSON.stringify({ providerAvailable, ...aiResult }) }
      });
      return { ...updated, extractionStatus: providerAvailable ? "provider-response" : "fallback", aiAvailable: providerAvailable };
    }

    const doc = devDocuments.find((d) => d.id === id && d.organizationId === user.organizationId);
    if (!doc) return notFound(reply);
    doc.status = "upload-only";
    doc.validation = JSON.stringify({ providerAvailable: false, issues: ["AI provider unavailable in development fallback mode."] });
    return { ...doc, extractionStatus: "fallback", aiAvailable: false, devFallback: true };
  });

  app.get("/api/v1/documents/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    if (prisma) {
      const doc = await (prisma as any).document.findUnique({ where: { id }, include: { shipment: true } });
      if (!doc || doc.shipment?.organizationId !== user.organizationId) return notFound(reply);
      return doc;
    }
    const doc = devDocuments.find((d) => d.id === id && d.organizationId === user.organizationId);
    if (!doc) return notFound(reply);
    return { ...doc, devFallback: true };
  });
}

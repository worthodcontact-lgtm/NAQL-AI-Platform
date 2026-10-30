import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthUser } from "../auth/routes.js";
import { aiGateway } from "./gateway.js";
import { answerCopilot, CopilotAuthorizationError, getConversation } from "./copilot.js";
import { retrieveContext } from "./retrieval.js";
import { assessShipment } from "../intelligence/risk.js";
import { AI_OCR_ENABLED, env } from "../config/env.js";
import { prisma } from "../db.js";

export async function registerAIRoutes(app: FastifyInstance) {
  const copilotSchema = z
    .object({
      message: z.string().trim().min(1).max(2000).optional(),
      question: z.string().trim().min(1).max(2000).optional(),
      conversationId: z.string().min(1).max(200).optional(),
      shipmentId: z.string().min(1).max(200).optional()
    })
    .refine((value) => Boolean(value.message ?? value.question), {
      message: "message (or question) is required"
    });

  app.get("/api/v1/ai/status", { onRequest: [app.authenticate] }, async () => ({
    provider: aiGateway.provider,
    model: aiGateway.model ?? null,
    providerAvailable: aiGateway.isConfigured,
    ocrEnabled: AI_OCR_ENABLED,
    retrievalMethod: "deterministic-keyword-v1",
    aiServiceUrlConfigured: Boolean(env.AI_SERVICE_URL)
  }));

  app.post("/api/v1/ai/copilot", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = copilotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    const user = getAuthUser(request);
    const message = parsed.data.message ?? parsed.data.question ?? "";
    try {
      const result = await answerCopilot({
        user,
        request: {
          message,
          conversationId: parsed.data.conversationId,
          shipmentId: parsed.data.shipmentId
        }
      });
      return result;
    } catch (error) {
      if (error instanceof CopilotAuthorizationError) {
        return reply.code(404).send({ error: "Conversation not found", code: error.code });
      }
      throw error;
    }
  });

  app.get("/api/v1/ai/conversations/:id", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    const conversation = await getConversation(user, id);
    if (!conversation) return reply.code(404).send({ error: "Not found" });
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        sources: message.sources,
        suggestedActions: message.suggestedActions,
        warnings: message.warnings,
        createdAt: message.createdAt
      }))
    };
  });

  app.post("/api/v1/ai/retrieval/search", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = z
      .object({
        query: z.string().trim().min(1).max(500),
        shipmentId: z.string().min(1).max(200).optional()
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });

    const user = getAuthUser(request);
    const result = await retrieveContext({
      user,
      query: parsed.data.query,
      shipmentId: parsed.data.shipmentId
    });
    return {
      method: result.method,
      empty: result.empty,
      sources: result.sources,
      // Snippets are authorized context, bounded and never include storage keys.
      snippets: result.chunks.map((chunk) => ({
        sourceId: chunk.source.id,
        sourceType: chunk.source.type,
        snippet: chunk.text.slice(0, 500)
      }))
    };
  });

  app.post("/api/v1/ai/predict-delay", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = z
      .object({
        shipmentId: z.string().min(1).optional(),
        // Legacy fields are accepted only to return a clear migration error.
        route: z.string().optional(),
        mode: z.string().optional(),
        departureDate: z.string().optional(),
        carrier: z.string().optional()
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    if (!parsed.data.shipmentId) {
      return reply.code(400).send({
        error: "shipmentId is required; delay estimates must use an authorized shipment record",
        code: "shipment_required"
      });
    }

    const user = getAuthUser(request);
    const result = await assessShipment({
      shipmentId: parsed.data.shipmentId,
      organizationId: user.organizationId
    });
    if (!result) return reply.code(404).send({ error: "Not found" });
    return { shipmentId: parsed.data.shipmentId, ...result.delay };
  });

  // Conversation persistence is only exposed when a database exists.
  if (!prisma) {
    app.get("/api/v1/ai/conversations", { onRequest: [app.authenticate] }, async () => ({
      items: [],
      persistence: "unavailable"
    }));
  }
}

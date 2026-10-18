import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAuthUser } from "../auth/routes.js";
import { callCopilot, predictDelay, CopilotRequest, DelayPredictionRequest } from "./client.js";

export async function registerAIRoutes(app: FastifyInstance) {
  app.post("/api/v1/ai/copilot", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = z.object({ question: z.string().min(1), context: z.record(z.unknown()).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const user = getAuthUser(request);
    const result = await callCopilot({ question: parsed.data.question, context: { ...parsed.data.context, organizationId: user.organizationId } } as CopilotRequest);
    return result;
  });

  app.post("/api/v1/ai/predict-delay", { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = z.object({ route: z.string().min(1), mode: z.string().min(1), departureDate: z.string().min(1), carrier: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const result = await predictDelay(parsed.data as DelayPredictionRequest);
    return result;
  });
}

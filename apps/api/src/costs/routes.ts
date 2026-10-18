import { FastifyInstance } from "fastify";
import { z } from "zod";
import { calculateLandedCost, LandedCostInput } from "../costs/landed-cost.js";

const schema = z.object({
  productCost: z.number().nonnegative(),
  freight: z.number().nonnegative(),
  insurance: z.number().nonnegative(),
  customsDutyRate: z.number().min(0).max(1),
  taxRate: z.number().min(0).max(1),
  fees: z.number().nonnegative(),
  currency: z.string().length(3)
});

export async function registerCostRoutes(app: FastifyInstance) {
  app.post("/api/v1/costs/landed-cost", async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    return calculateLandedCost(parsed.data as LandedCostInput);
  });
}

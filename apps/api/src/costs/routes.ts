import { FastifyInstance } from "fastify";
import { z } from "zod";
import { assessLandedCost } from "../costs/landed-cost.js";
import { requireCompanyPermission } from "../auth/company.js";

const schema = z.object({
  productCost: z.number().nonnegative().optional(),
  freight: z.number().nonnegative().optional(),
  insurance: z.number().nonnegative().optional(),
  customsDutyRate: z.number().min(0).max(1).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  fees: z.number().nonnegative().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  componentCurrencies: z.object({
    productCost: z.string().regex(/^[A-Z]{3}$/).optional(),
    freight: z.string().regex(/^[A-Z]{3}$/).optional(),
    insurance: z.string().regex(/^[A-Z]{3}$/).optional(),
    fees: z.string().regex(/^[A-Z]{3}$/).optional()
  }).optional()
}).superRefine((input, ctx) => {
  for (const [component, currency] of Object.entries(input.componentCurrencies ?? {})) {
    if (currency && currency !== input.currency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["componentCurrencies", component], message: `Currency for ${component} must match ${input.currency}; conversion is not configured.` });
    }
  }
});

export async function registerCostRoutes(app: FastifyInstance) {
  app.post(
    "/api/v1/costs/landed-cost",
    { onRequest: [app.authenticate], preHandler: requireCompanyPermission("costs.read") },
    async (request, reply) => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    const { componentCurrencies: _componentCurrencies, ...input } = parsed.data;
    return assessLandedCost(input);
    }
  );
}

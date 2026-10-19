import { FastifyInstance } from "fastify";
import { z } from "zod";
import { TradeError, comtradeConfigured, getTradeOverview } from "./comtrade.js";

const querySchema = z.object({
  /** UN M49 numeric reporter code. 818 = Egypt. */
  reporter: z.string().regex(/^\d{1,3}$/).default("818"),
  year: z.coerce.number().int().min(1962).max(2100).optional(),
  flow: z.enum(["M", "X"]).default("M"),
  limit: z.coerce.number().int().min(3).max(50).default(10)
});

export async function registerTradeRoutes(app: FastifyInstance) {
  /**
   * Configuration probe. Does not call the upstream service, so it is safe to poll.
   * It reports whether a key exists — never the key itself.
   */
  app.get("/api/v1/trade/status", { onRequest: [app.authenticate] }, async () => ({
    configured: comtradeConfigured(),
    source: "UN Comtrade",
    upstream: "comtradeapi.un.org",
    message: comtradeConfigured()
      ? "Trade data provider is configured."
      : "Trade data provider is not configured. Set COMTRADE_API_KEY in the server environment."
  }));

  /**
   * Aggregated trade overview: totals, top partners, top HS chapters, and a five-year
   * series. The upstream free tier is limited, so the route is capped and every
   * response is cached in the client for 30 minutes.
   *
   * Data is global reference data, not tenant data: it is identical for every
   * organization. Access still requires a valid session.
   */
  app.get(
    "/api/v1/trade/overview",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", issues: parsed.error.issues });
      }

      // The previous calendar year is the most recent one that is normally complete.
      const year = parsed.data.year ?? new Date().getUTCFullYear() - 1;

      try {
        return await getTradeOverview({ ...parsed.data, year });
      } catch (error) {
        if (error instanceof TradeError) {
          return reply.code(error.status).send({
            error: error.message,
            code: error.code,
            ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {})
          });
        }

        request.log.error({ message: (error as Error)?.message }, "trade overview failed");
        return reply.code(500).send({
          error: "Unexpected error while loading trade data.",
          code: "internal_error"
        });
      }
    }
  );
}

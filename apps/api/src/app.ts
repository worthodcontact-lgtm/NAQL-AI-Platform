import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { env } from "./config/env.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerShipmentRoutes } from "./shipments/routes.js";
import { registerCostRoutes } from "./costs/routes.js";
import { registerQuotationRoutes } from "./quotations/routes.js";
import { registerPortRoutes } from "./ports/routes.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { registerAIRoutes } from "./ai/routes.js";
import { registerCompanyRoutes } from "./companies/routes.js";
import { registerRfqRoutes } from "./rfq/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "naql-api", env: env.NODE_ENV }));

  await registerAuthRoutes(app);
  await registerShipmentRoutes(app);
  await registerCostRoutes(app);
  await registerQuotationRoutes(app);
  await registerPortRoutes(app);
  await registerDocumentRoutes(app);
  await registerAIRoutes(app);
  await registerCompanyRoutes(app);
  await registerRfqRoutes(app);
  await registerAdminRoutes(app);

  return app;
}

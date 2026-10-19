import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { corsOrigins, env } from "./config/env.js";
import { databaseReachable, persistenceMode } from "./db.js";
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

/**
 * Recursively convert Prisma `Decimal` values to plain numbers and `Date` values to
 * ISO strings so every response shape is identical in database and fallback mode.
 *
 * Detection is duck-typed (no Prisma import) so this stays valid even when the
 * generated client is not present.
 */
function isDecimalLike(value: any): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.toNumber === "function" &&
    typeof value.toFixed === "function" &&
    !(value instanceof Date)
  );
}

function normalize(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (isDecimalLike(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const output: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) output[key] = normalize(nested);
    return output;
  }
  return value;
}

export async function buildApp() {
  const isTest = env.NODE_ENV === "test";

  const app = Fastify({
    logger: isTest ? false : { level: env.LOG_LEVEL },
    genReqId: () => randomUUID()
  });

  await app.register(cors, { origin: corsOrigins(), credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  /**
   * Prisma returns DECIMAL columns as Decimal objects. They stringify inconsistently
   * across modes (a string in database mode, a number in the in-memory fallback), which
   * would make client arithmetic unreliable. Normalise every outgoing payload once here.
   */
  app.addHook("preSerialization", async (_request, _reply, payload) => normalize(payload));

  /** Liveness: the process is up. Does not touch dependencies. */
  app.get("/health", async () => ({
    status: "ok",
    service: "naql-api",
    env: env.NODE_ENV,
    persistenceMode
  }));

  /** Readiness: dependencies are actually usable. */
  app.get("/ready", async (_request, reply) => {
    const database = await databaseReachable();
    const ready = persistenceMode === "database" ? database : true;
    return reply.code(ready ? 200 : 503).send({
      ready,
      persistenceMode,
      database: persistenceMode === "database" ? (database ? "connected" : "unreachable") : "not-configured"
    });
  });

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

import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import { corsOrigins, env, RATE_LIMIT_MAX } from "./config/env.js";
import { databaseReachable, persistenceMode, prisma } from "./db.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { loadPrincipal } from "./auth/principal.js";
import { registerShipmentRoutes } from "./shipments/routes.js";
import { registerCostRoutes } from "./costs/routes.js";
import { registerQuotationRoutes } from "./quotations/routes.js";
import { registerPortRoutes } from "./ports/routes.js";
import { registerDocumentRoutes } from "./documents/routes.js";
import { registerAIRoutes } from "./ai/routes.js";
import { registerIntelligenceRoutes } from "./intelligence/routes.js";
import { registerCompanyRoutes } from "./companies/routes.js";
import { registerCompanyWorkspaceRoutes } from "./company/routes.js";
import { registerRfqRoutes } from "./rfq/routes.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { getIntegrationRegistry } from "./integrations/registry.js";
import { registerTradeRoutes } from "./trade/routes.js";
import { registerShipmentEventRoutes } from "./shipments/events.js";
import { registerNotificationRoutes } from "./notifications/routes.js";

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
    // Document uploads are limited to 2 MB after base64 decoding. Base64 adds
    // roughly 33% plus JSON overhead, so the transport limit must be larger.
    bodyLimit: 4 * 1024 * 1024,
    logger: isTest
      ? false
      : {
          level: env.LOG_LEVEL,
          // Fastify's default serializer does not normally log headers, but
          // redaction is defence in depth for custom serializers and errors.
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "res.headers['set-cookie']"
            ],
            censor: "[redacted]"
          }
        },
    genReqId: () => randomUUID()
  });

  await app.register(cors, { origin: corsOrigins(), credentials: true });
  await app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    // Keep the error shape consistent with the rest of the API so the Arabic UI
    // can map `rate_limited` instead of displaying an English framework message.
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: "Too Many Requests",
      code: "rate_limited",
      message: "Too many requests; try again shortly."
    })
  });
  await app.register(jwt, { secret: env.JWT_SECRET });

  /**
   * Verify the JWT, then reload the actor from PostgreSQL so that suspensions,
   * platform-role changes, and session revocations apply on the very next request.
   * In the in-memory fallback there is no account store to consult; tokens are
   * trusted and platform administration is unavailable (see admin routes).
   */
  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized", code: "unauthorized" });
    }

    const raw = request.user as any;

    /**
     * Administration tokens issued before expiring JWTs were introduced had no
     * `exp` claim and would otherwise be immortal. Refuse those legacy admin
     * tokens; newly issued admin tokens always carry a short expiry.
     */
    if (raw?.scope === "admin" && !Number.isFinite(Number(raw?.exp))) {
      return reply.code(401).send({ error: "Session expired", code: "session_expired" });
    }

    if (!prisma) return;

    let principal;
    try {
      principal = await loadPrincipal(String(raw?.sub ?? ""));
    } catch {
      return reply.code(503).send({ error: "Authentication temporarily unavailable", code: "auth_unavailable" });
    }

    if (!principal) {
      return reply.code(401).send({ error: "Unauthorized", code: "account_not_found" });
    }
    if (principal.status !== "active") {
      return reply.code(403).send({ error: "Account suspended", code: "account_suspended" });
    }

    // Legacy tokens without `sv` are treated as version 0. The database record is
    // authoritative regardless, so this only affects explicit revocations.
    const tokenVersion = Number.isFinite(Number(raw?.sv)) ? Number(raw?.sv) : 0;
    if (tokenVersion !== principal.sessionVersion) {
      return reply.code(401).send({ error: "Session revoked", code: "session_revoked" });
    }

    request.user = {
      ...raw,
      sub: principal.id,
      email: principal.email,
      displayName: principal.displayName,
      organizationId: principal.organizationId,
      roles: principal.roles,
      accountType: principal.accountType,
      tradeRole: principal.tradeRole,
      platformRole: principal.platformRole,
      status: principal.status,
      scope: raw?.scope === "admin" ? "admin" : "app"
    };
  });

  /**
   * Prisma returns DECIMAL columns as Decimal objects. They stringify inconsistently
   * across modes (a string in database mode, a number in the in-memory fallback), which
   * would make client arithmetic unreliable. Normalise every outgoing payload once here.
   */
  app.addHook("preSerialization", async (_request, _reply, payload) => normalize(payload));

  /** Baseline response hardening for JSON API and sensitive authentication replies. */
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (request.url.startsWith("/api/v1/admin") || request.url.startsWith("/api/v1/auth")) {
      reply.header("Cache-Control", "no-store");
    }
    if (env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return payload;
  });

  /**
   * Never return an internal exception message to a client. Prisma errors can
   * contain table/column names and SQL fragments; the correlation id lets an
   * operator find the full server-side log entry instead.
   */
  app.setErrorHandler((error: any, request, reply) => {
    const status = Number(error?.statusCode);
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;

    request.log.error(
      { err: error, requestId: request.id, method: request.method, url: request.url },
      "request failed"
    );

    if (safeStatus >= 500) {
      return reply.code(500).send({
        error: "Internal server error",
        code: "internal_error",
        requestId: request.id
      });
    }

    return reply.code(safeStatus).send({
      error: typeof error?.message === "string" ? error.message : "Request failed",
      code: typeof error?.code === "string" ? error.code : "request_failed",
      requestId: request.id
    });
  });

  /** Liveness: the process is up. Does not touch dependencies. */
  app.get("/health", async () => ({
    status: "ok",
    service: "naql-api",
    env: env.NODE_ENV,
    persistenceMode
  }));

  /** Readiness: dependencies are actually usable. */
  app.get("/ready", async (request, reply) => {
    const database = await databaseReachable();
    const ready = persistenceMode === "database" ? database : true;
    const query = request.query as { detailed?: string };
    let dependencies: Array<{
      id: string;
      status: string;
      configuration: string;
      connectivity: string;
      operation: string;
      capabilities: string[];
    }> | undefined;
    if (query.detailed === "1") {
      const registry = await getIntegrationRegistry();
      // Detailed readiness intentionally exposes only operational state, never
      // provider credentials, evidence text, or provider error bodies.
      dependencies = registry.items
        .filter((item) => ["database", "ai", "pdf-ocr", "object-storage", "email"].includes(item.id))
        .map((item) => ({
          id: item.id,
          status: item.status,
          configuration: item.configuration,
          connectivity: item.connectivity,
          operation: item.operation,
          capabilities: item.capabilities
        }));
    }
    return reply.code(ready ? 200 : 503).send({
      ready,
      persistenceMode,
      database: persistenceMode === "database" ? (database ? "connected" : "unreachable") : "not-configured",
      ...(dependencies ? { dependencies } : {})
    });
  });

  await registerAuthRoutes(app);
  await registerShipmentRoutes(app);
  await registerCostRoutes(app);
  await registerQuotationRoutes(app);
  await registerPortRoutes(app);
  await registerDocumentRoutes(app);
  await registerAIRoutes(app);
  await registerIntelligenceRoutes(app);
  await registerCompanyRoutes(app);
  await registerCompanyWorkspaceRoutes(app);
  await registerRfqRoutes(app);
  await registerAdminRoutes(app);
  await registerTradeRoutes(app);
  await registerShipmentEventRoutes(app);
  await registerNotificationRoutes(app);

  return app;
}

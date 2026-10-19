import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().default("dev-only-secret-change-me"),
  AI_SERVICE_URL: z.string().default("http://127.0.0.1:8000"),
  AI_REQUEST_TIMEOUT_MS: z.string().default("5000"),
  /** Comma-separated allow-list. Required in production. */
  CORS_ORIGINS: z.string().optional(),
  /** Absolute or relative directory for local file storage. */
  STORAGE_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default("info")
});

export const env = envSchema.parse(process.env);
export const AI_REQUEST_TIMEOUT_MS = Number(env.AI_REQUEST_TIMEOUT_MS);

export const isProduction = env.NODE_ENV === "production";

/**
 * Persistence mode is derived from configuration only. It is reported by /health and
 * surfaced in the UI so an operator can never mistake memory storage for a database.
 */
export const persistenceMode: "database" | "memory" = env.DATABASE_URL ? "database" : "memory";

export function corsOrigins(): string[] | true {
  const configured = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  // Development convenience only. Production must configure an explicit allow-list.
  return isProduction ? [] : true;
}

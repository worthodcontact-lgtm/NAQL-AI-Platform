import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load .env before configuration is parsed.
 *
 * Uses Node's built-in loader (>= 20.12) so no dependency is required. The repo-root
 * `.env` is git-ignored. Real environment variables always win: they are captured first
 * and restored afterwards, so an explicit `$env:DATABASE_URL=...` is never overridden.
 */
function loadEnvFiles(files: string[]) {
  // Escape hatch for tests and CI that must exercise the in-memory fallback path.
  if (process.env.NAQL_DISABLE_ENV_FILE === "1") return;

  const loader = (process as any).loadEnvFile;
  if (typeof loader !== "function") return;

  const realEnvironment = { ...process.env };
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      loader.call(process, file);
    } catch {
      // A malformed .env must not crash start-up; the schema check reports missing values.
    }
  }
  for (const [key, value] of Object.entries(realEnvironment)) {
    if (value !== undefined) process.env[key] = value;
  }
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
loadEnvFiles([
  path.resolve(configDir, "../../../../.env"), // repository root
  path.resolve(configDir, "../../.env") // apps/api/.env
]);

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().default("dev-only-secret-change-me"),
  /** Lifetime of ordinary application tokens. */
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("12h"),
  /** Lifetime of administration tokens; deliberately shorter than app tokens. */
  ADMIN_JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default("8h"),
  AI_SERVICE_URL: z.string().default("http://127.0.0.1:8000"),
  AI_REQUEST_TIMEOUT_MS: z.string().default("5000"),
  /** Comma-separated allow-list. Required in production. */
  CORS_ORIGINS: z.string().optional(),
  /** Absolute or relative directory for local file storage. */
  STORAGE_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  /**
   * UN Comtrade subscription keys (Azure APIM format). Server-side only: they are
   * never exposed to the browser. The secondary key is used for rotation when the
   * primary is rejected.
   */
  COMTRADE_API_KEY: z.string().optional(),
  COMTRADE_API_KEY_SECONDARY: z.string().optional(),
  COMTRADE_API_BASE_URL: z.string().default("https://comtradeapi.un.org"),
  COMTRADE_REQUEST_TIMEOUT_MS: z.string().default("12000")
});

const parsedEnv = envSchema.parse(process.env);

/**
 * Production must never run with the development JWT secret or a permissive
 * CORS configuration. Failing at start-up is safer than serving signed tokens
 * that anyone who has read the repository can forge.
 */
if (parsedEnv.NODE_ENV === "production") {
  const jwtSecret = parsedEnv.JWT_SECRET.trim();
  if (jwtSecret === "dev-only-secret-change-me" || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be a random value of at least 32 characters when NODE_ENV=production.");
  }
  if (!parsedEnv.CORS_ORIGINS || parsedEnv.CORS_ORIGINS.trim() === "") {
    throw new Error("CORS_ORIGINS must contain an explicit allow-list when NODE_ENV=production.");
  }
}

export const env = parsedEnv;
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

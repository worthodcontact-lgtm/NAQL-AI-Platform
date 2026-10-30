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

/**
 * The test suite creates and deletes real rows. Pointing it at a hosted
 * database (production, staging, a teammate's Railway instance) is how test
 * data ends up mixed with — or replacing — real records. Unless the operator
 * explicitly opts in, a non-local DATABASE_URL is ignored while tests run, so
 * the database-backed suites skip instead of writing to a remote server.
 *
 * Opt in only for a disposable test database:
 *   $env:NAQL_ALLOW_REMOTE_DB_TESTS="1"
 */
function isLocalDatabaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

const runningTests = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
if (
  runningTests &&
  process.env.DATABASE_URL &&
  !isLocalDatabaseUrl(process.env.DATABASE_URL) &&
  process.env.NAQL_ALLOW_REMOTE_DB_TESTS !== "1"
) {
  console.warn(
    "[naql] DATABASE_URL points at a non-local server. Database-backed tests will be skipped. " +
      "Set NAQL_ALLOW_REMOTE_DB_TESTS=1 only when the target is a disposable test database."
  );
  delete process.env.DATABASE_URL;
}

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
  AI_REQUEST_TIMEOUT_MS: z.string().default("30000"),
  /** none | openai | openai-compatible | ollama. `none` keeps deterministic features working. */
  AI_PROVIDER: z.enum(["none", "openai", "openai-compatible", "ollama"]).default("none"),
  AI_MODEL: z.string().optional(),
  /** Server-side only. Never exposed to the browser. */
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  AI_MAX_RETRIES: z.string().default("1"),
  AI_OCR_ENABLED: z.string().default("false"),
  AI_RAG_TOP_K: z.string().default("5"),
  /** Comma-separated allow-list. Required in production. */
  CORS_ORIGINS: z.string().optional(),
  /** Absolute or relative directory for local file storage. */
  STORAGE_PATH: z.string().optional(),
  /**
   * none | clamav. `none` reports every upload as not_scanned; it never claims a
   * file was scanned. `clamav` uses the clamd INSTREAM protocol over TCP.
   */
  MALWARE_SCANNER: z.enum(["none", "clamav"]).default("none"),
  MALWARE_SCANNER_HOST: z.string().default("127.0.0.1"),
  MALWARE_SCANNER_PORT: z.string().default("3310"),
  MALWARE_SCANNER_TIMEOUT_MS: z.string().default("5000"),
  /** When a configured scanner is unreachable, reject the upload instead of storing it. */
  MALWARE_SCAN_FAIL_CLOSED: z.string().default("true"),
  /** Retention in days. 0 disables automatic expiry. */
  DOCUMENT_RETENTION_DAYS: z.string().default("0"),
  COMPANY_DOCUMENT_RETENTION_DAYS: z.string().default("0"),
  /** Maximum decoded document size in bytes. Defaults to 2 MB. */
  MAX_DOCUMENT_BYTES: z.string().default(String(2 * 1024 * 1024)),
  LOG_LEVEL: z.string().default("info"),
  /** Requests allowed per client per minute. Raise only for isolated test servers. */
  RATE_LIMIT_MAX: z.string().default("100"),
  /**
   * External notification delivery. `none` keeps in-app notifications only and
   * never claims an email was sent. `resend` requires a server-side API key and
   * a verified sender. Configuration alone does not prove delivery.
   */
  EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REQUEST_TIMEOUT_MS: z.string().default("10000"),
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
export const AI_MAX_RETRIES = Math.max(0, Math.min(3, Number(env.AI_MAX_RETRIES) || 0));
export const AI_RAG_TOP_K = Math.max(1, Math.min(20, Number(env.AI_RAG_TOP_K) || 5));
export const AI_OCR_ENABLED = env.AI_OCR_ENABLED === "true";
export const MAX_DOCUMENT_BYTES = Math.max(
  1,
  Math.min(20 * 1024 * 1024, Number(env.MAX_DOCUMENT_BYTES) || 2 * 1024 * 1024)
);
export const DOCUMENT_RETENTION_DAYS = Math.max(0, Number(env.DOCUMENT_RETENTION_DAYS) || 0);
export const COMPANY_DOCUMENT_RETENTION_DAYS = Math.max(
  0,
  Number(env.COMPANY_DOCUMENT_RETENTION_DAYS) || 0
);
export const malwareConfig = {
  scanner: env.MALWARE_SCANNER,
  host: env.MALWARE_SCANNER_HOST,
  port: Math.max(1, Math.min(65535, Number(env.MALWARE_SCANNER_PORT) || 3310)),
  timeoutMs: Math.max(500, Math.min(60000, Number(env.MALWARE_SCANNER_TIMEOUT_MS) || 5000)),
  failClosed: env.MALWARE_SCAN_FAIL_CLOSED !== "false"
} as const;
/** Provider credentials are read only on the server. */
export const aiConfig = {
  provider: env.AI_PROVIDER,
  model: env.AI_MODEL?.trim() || undefined,
  apiKey: env.AI_API_KEY?.trim() || undefined,
  baseUrl: env.AI_BASE_URL?.trim() || undefined,
  timeoutMs: Number.isFinite(AI_REQUEST_TIMEOUT_MS) ? AI_REQUEST_TIMEOUT_MS : 30000,
  maxRetries: AI_MAX_RETRIES
} as const;

/** Server-side email credentials. Never expose these values to the browser. */
export const emailConfig = {
  provider: env.EMAIL_PROVIDER,
  apiKey: env.EMAIL_API_KEY?.trim() || undefined,
  from: env.EMAIL_FROM?.trim() || undefined,
  timeoutMs: Math.max(
    1000,
    Math.min(60000, Number(env.EMAIL_REQUEST_TIMEOUT_MS) || 10000)
  )
} as const;

export const RATE_LIMIT_MAX = Math.max(1, Math.min(100_000, Number(env.RATE_LIMIT_MAX) || 100));

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

import { PrismaClient } from "@prisma/client";
import { env, isProduction, persistenceMode } from "./config/env.js";

/**
 * In production a database is mandatory. The API must never silently accept
 * business data into process memory and lose it on restart.
 */
if (isProduction && !env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required when NODE_ENV=production. NAQL AI refuses to start with in-memory storage in production."
  );
}

export const prisma = env.DATABASE_URL ? new PrismaClient() : null;

export { persistenceMode };

/** Real connectivity check used by /health. Returns false instead of throwing. */
export async function databaseReachable(): Promise<boolean> {
  if (!prisma) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

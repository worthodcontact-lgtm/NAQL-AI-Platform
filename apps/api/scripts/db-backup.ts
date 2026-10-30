/**
 * Export the whole database to a timestamped JSON file.
 *
 *   pnpm --filter @naql/api db:backup
 *   pnpm --filter @naql/api db:backup -- --out "D:\backups\naql.json"
 *
 * The file contains personal data (emails, password hashes, company records).
 * Treat it as a secret: keep it off source control and share it only over a
 * private channel. Restore with `pnpm --filter @naql/api db:restore`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import "../src/config/env.js";
import { assertDatabaseSchema, TABLES, validateTableCoverage } from "./db-tables.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function defaultBackupDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return process.env.NAQL_BACKUP_DIR ?? path.resolve(here, "..", "..", "..", "backups");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Set it in the repository .env or the shell.");
  }

  validateTableCoverage();

  const prisma = new PrismaClient();
  const exportedAt = new Date().toISOString();
  const stamp = exportedAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const client = prisma as unknown as Record<string, { findMany: () => Promise<unknown[]>; count: () => Promise<number> }>;

  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  try {
    await assertDatabaseSchema(prisma);
    for (const table of TABLES) {
      const rows = await client[table].findMany();
      data[table] = rows;
      counts[table] = rows.length;
      process.stdout.write(`  ${table}: ${rows.length}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }

  const target = argValue("--out")
    ? path.resolve(argValue("--out")!)
    : path.join(defaultBackupDir(), `naql-backup-${stamp}.json`);

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify({ format: "naql-backup/1", exportedAt, tables: data }, null, 2),
    "utf8"
  );

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  console.log(`\nBackup written to ${target}`);
  console.log(`Total rows: ${total}`);
  console.log("This file contains personal data. Do not commit or share it publicly.");
}

main().catch((error) => {
  console.error(`backup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

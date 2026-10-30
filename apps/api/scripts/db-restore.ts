/**
 * Restore a JSON backup produced by `db:backup` into the database that
 * DATABASE_URL points at.
 *
 *   pnpm --filter @naql/api db:restore -- --file ..\..\backups\naql-backup-....json --dry-run
 *   pnpm --filter @naql/api db:restore -- --file ... --replace
 *
 * Safety rules:
 *   - The backup must contain every table required by the current Prisma schema.
 *   - `--dry-run` only reports what would happen.
 *   - Restoring into a database that already has rows is refused unless
 *     `--replace` is passed. `--replace` DELETES the existing rows first.
 *   - `--replace` is allowed only on a database whose name clearly marks it as a
 *     test/restore/drill target, or when the operator explicitly sets
 *     NAQL_ALLOW_DESTRUCTIVE_RESTORE=1 for a disposable database.
 *   - The delete + insert run in one transaction, so a failed restore leaves
 *     the previous contents untouched.
 *   - Row counts are verified after insertion before the transaction commits.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import "../src/config/env.js";
import { assertDatabaseSchema, TABLES, validateTableCoverage } from "./db-tables.js";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function targetDatabaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * `--replace` is destructive. Require either an obviously disposable database
 * name (test, restore, drill) or an explicit operator opt-in. This is checked
 * before any transaction starts.
 */
function assertReplaceAllowed(): void {
  const url = process.env.DATABASE_URL ?? "";
  const database = targetDatabaseName(url);
  const looksDisposable = /(^|[_-])(test|testing|restore|drill)([_-]|$)/i.test(database);
  if (looksDisposable) return;
  if (process.env.NAQL_ALLOW_DESTRUCTIVE_RESTORE === "1") return;
  throw new Error(
    `Refusing --replace on database "${database}". Use a dedicated test/restore database, ` +
      "or set NAQL_ALLOW_DESTRUCTIVE_RESTORE=1 only after verifying the target is disposable."
  );
}

function chunk<T>(rows: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Set it in the repository .env or the shell.");
  }

  const file = argValue("--file");
  if (!file) {
    throw new Error("--file <path> is required. Example: --file ../../backups/naql-backup-2026-10-20_01-00-00.json");
  }

  const dryRun = hasFlag("--dry-run");
  const replace = hasFlag("--replace");
  const absolute = path.resolve(file);

  const raw = await fs.readFile(absolute, "utf8");
  const backup = JSON.parse(raw) as {
    format?: string;
    exportedAt?: string;
    tables?: Record<string, unknown[]>;
  };

  if (backup.format !== "naql-backup/1" || !backup.tables) {
    throw new Error(`${absolute} is not a naql-backup/1 file.`);
  }

  validateTableCoverage();
  const missingTables = TABLES.filter((table) => !Object.prototype.hasOwnProperty.call(backup.tables, table));
  if (missingTables.length) {
    throw new Error(
      `Backup is incomplete; it is missing: ${missingTables.join(", ")}. ` +
        "Do not restore this file. Take a new backup with the current db:backup script."
    );
  }
  const unexpectedTables = Object.keys(backup.tables).filter(
    (table) => !(TABLES as readonly string[]).includes(table)
  );
  if (unexpectedTables.length) {
    console.warn(`Ignoring unknown backup tables: ${unexpectedTables.join(", ")}`);
  }

  if (replace) assertReplaceAllowed();

  const prisma = new PrismaClient();
  const client = prisma as unknown as Record<
    string,
    {
      count: (args?: unknown) => Promise<number>;
      createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
      deleteMany: () => Promise<{ count: number }>;
    }
  >;

  try {
    await assertDatabaseSchema(prisma);

    const incoming: Record<string, number> = {};
    for (const table of TABLES) incoming[table] = backup.tables![table].length;

    const existing: Record<string, number> = {};
    let existingTotal = 0;
    for (const table of TABLES) {
      existing[table] = await client[table].count();
      existingTotal += existing[table];
    }

    console.log(`Backup: ${absolute}`);
    console.log(`Exported at: ${backup.exportedAt ?? "unknown"}`);
    console.log(`Incoming rows: ${Object.values(incoming).reduce((a, b) => a + b, 0)}`);
    console.log(`Existing rows in target: ${existingTotal}`);
    for (const table of TABLES) {
      if (existing[table] || incoming[table]) {
        console.log(`  ${table}: existing ${existing[table]} -> incoming ${incoming[table]}`);
      }
    }

    if (dryRun) {
      console.log("\nDry run: no changes were written.");
      return;
    }

    if (existingTotal > 0 && !replace) {
      throw new Error(
        "The target database already contains rows. Re-run with --replace to delete them first, or restore into an empty database."
      );
    }

    await prisma.$transaction(
      async (tx) => {
        const txClient = tx as unknown as typeof client;

        if (replace) {
          for (const table of [...TABLES].reverse()) {
            const result = await txClient[table].deleteMany();
            if (result.count) console.log(`deleted ${result.count} ${table} row(s)`);
          }
        }

        for (const table of TABLES) {
          const rows = backup.tables![table];
          if (rows.length === 0) continue;
          let inserted = 0;
          // Keep statements below PostgreSQL's parameter limit when a table is
          // large. Every chunk remains inside the same transaction.
          for (const batch of chunk(rows, 500)) {
            const result = await txClient[table].createMany({ data: batch });
            inserted += result.count;
          }
          if (inserted !== rows.length) {
            throw new Error(`Inserted ${inserted} of ${rows.length} rows into ${table}; rolling back.`);
          }
          console.log(`inserted ${inserted} ${table} row(s)`);
        }

        // Verify the transaction contents before committing. This catches
        // createMany silently dropping rows and proves the restore is complete.
        for (const table of TABLES) {
          const count = await txClient[table].count();
          if (count !== incoming[table]) {
            throw new Error(
              `Post-restore count mismatch for ${table}: expected ${incoming[table]}, found ${count}; rolling back.`
            );
          }
        }
      },
      { timeout: 180_000, maxWait: 30_000 }
    );

    console.log("\nRestore complete. Row counts match the backup.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`restore failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

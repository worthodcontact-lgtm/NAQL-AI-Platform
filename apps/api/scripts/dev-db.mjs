#!/usr/bin/env node
/**
 * Native Windows development database.
 *
 * Starts a real PostgreSQL cluster from the `embedded-postgres` binaries using a
 * repository-local data directory. No administrator rights, no Windows service,
 * and no Docker are required.
 *
 *   node scripts/dev-db.mjs
 *
 * The cluster listens on 127.0.0.1:5433 with database `naql_ai`.
 * Data persists in `<repo>/.pgdata` across restarts.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const databaseDir = path.join(repoRoot, ".pgdata");

const PORT = Number(process.env.NAQL_DEV_DB_PORT ?? 5433);
const USER = process.env.NAQL_DEV_DB_USER ?? "naql";
const PASSWORD = process.env.NAQL_DEV_DB_PASSWORD ?? "naql";
const DATABASE = process.env.NAQL_DEV_DB_NAME ?? "naql_ai";

const connectionString = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}?schema=public`;

const pg = new EmbeddedPostgres({
  databaseDir,
  port: PORT,
  user: USER,
  password: PASSWORD,
  persistent: true,
  authMethod: "password",
  // Windows initdb cannot use the default POSIX locale layout reliably.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: (message) => process.stdout.write(`[postgres] ${message}\n`),
  onError: (message) => process.stderr.write(`[postgres] ${message}\n`)
});

async function main() {
  const initialised = fs.existsSync(path.join(databaseDir, "PG_VERSION"));

  if (!initialised) {
    console.log(`Initialising PostgreSQL cluster at ${databaseDir} ...`);
    fs.mkdirSync(databaseDir, { recursive: true });
    await pg.initialise();
  } else {
    console.log(`Reusing existing PostgreSQL cluster at ${databaseDir}`);
  }

  await pg.start();
  console.log(`PostgreSQL is running on 127.0.0.1:${PORT}`);

  try {
    await pg.createDatabase(DATABASE);
    console.log(`Created database "${DATABASE}"`);
  } catch (error) {
    // Creating an existing database raises an error; that is the expected path.
    const message = String(error?.message ?? error);
    if (!/already exists/i.test(message)) throw error;
    console.log(`Database "${DATABASE}" already exists`);
  }

  console.log("");
  console.log("Add this to your environment:");
  console.log(`  $env:DATABASE_URL="${connectionString}"`);
  console.log("");
  console.log("Then run:");
  console.log("  pnpm --filter @naql/api prisma:migrate");
  console.log("  pnpm --filter @naql/api prisma:seed");
  console.log("");
  console.log("Press Ctrl+C to stop PostgreSQL.");

  const shutdown = async () => {
    console.log("\nStopping PostgreSQL ...");
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start the development database:");
  console.error(error);
  process.exit(1);
});

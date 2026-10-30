/**
 * Run the complete API suite against a throwaway embedded PostgreSQL cluster.
 * This deliberately never touches the persistent .pgdata development cluster.
 *
 *   pnpm --filter @naql/api run test:isolated
 */
import EmbeddedPostgres from "embedded-postgres";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = os.tmpdir();
const clusterDir = await fs.mkdtemp(path.join(tempRoot, "naql-ai-phase41-pg-"));
const database = "naql_ai_phase41_test";
const user = "naql_test";
const password = randomBytes(24).toString("hex");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Failed to reserve a local PostgreSQL port"));
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const port = await freePort();
const databaseUrl = `postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
const env = {
  ...process.env,
  NODE_ENV: "test",
  VITEST: "true",
  NAQL_DISABLE_ENV_FILE: "1",
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
  JWT_SECRET: `phase41-test-${randomUUID()}-only`,
  STORAGE_PATH: path.join(clusterDir, "documents"),
  // Playwright drives many pages/API calls in a short window. The isolated API
  // process has no public exposure, so the production rate limit would only
  // create flaky browser tests rather than protect anything.
  RATE_LIMIT_MAX: "10000"
};

const pg = new EmbeddedPostgres({
  databaseDir: clusterDir,
  port,
  user,
  password,
  persistent: true,
  authMethod: "password",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: (message) => process.stdout.write(`[phase41-postgres] ${message}\n`),
  onError: (message) => process.stderr.write(`[phase41-postgres] ${message}\n`)
});

function run(args, runEnv = env) {
  const result = spawnSync(process.execPath, args, {
    cwd: apiRoot,
    env: runEnv,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`node ${args.join(" ")} exited with ${result.status}`);
}

let started = false;
let failure;
const servers = [];
async function waitFor(url, label) {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready: ${url}`);
}
function start(command, args, cwd, serverEnv) {
  const child = spawn(command, args, { cwd, env: serverEnv, stdio: "inherit", windowsHide: true });
  child.once("error", (error) => { failure ??= error; });
  servers.push(child);
  return child;
}
try {
  const parsed = new URL(databaseUrl);
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== String(port) || parsed.pathname.slice(1) !== database) {
    throw new Error("Refusing to migrate: isolated test database target verification failed");
  }
  await pg.initialise();
  await pg.start();
  started = true;
  await pg.createDatabase(database);
  console.log(`Verified isolated PostgreSQL target: 127.0.0.1:${port}/${database}`);

  run(["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  run(["node_modules/prisma/build/index.js", "migrate", "status", "--schema", "prisma/schema.prisma"]);
  run(["node_modules/prisma/build/index.js", "generate", "--schema", "prisma/schema.prisma"]);
  run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
  run(["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)]);

  const webRoot = path.resolve(apiRoot, "../../apps/web");
  const apiEnv = { ...env, PORT: "4001", HOST: "127.0.0.1" };
  const apiServer = start(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], apiRoot, apiEnv);
  await waitFor("http://127.0.0.1:4001/health", "API");
  const webEnv = {
    ...process.env,
    NODE_ENV: "test",
    NEXT_PUBLIC_API_URL: "http://127.0.0.1:4001",
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.resolve(apiRoot, "../../.playwright-browsers")
  };
  const webServer = start(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], webRoot, webEnv);
  await waitFor("http://127.0.0.1:3100/login", "web app");
  try {
    run([path.join(webRoot, "node_modules/@playwright/test/cli.js"), "test", "--config", path.join(webRoot, "playwright.config.ts")], webEnv);
  } finally {
    for (const child of [webServer, apiServer]) {
      if (!child.killed) child.kill("SIGTERM");
    }
  }
} catch (error) {
  failure = error;
} finally {
  for (const child of servers) {
    if (!child.killed) child.kill("SIGTERM");
  }
  if (started) {
    try { await pg.stop(); }
    catch (error) { failure ??= error; }
  }
  const resolvedTempRoot = await fs.realpath(tempRoot);
  const resolvedClusterDir = await fs.realpath(clusterDir).catch(() => null);
  if (resolvedClusterDir && path.dirname(resolvedClusterDir) === resolvedTempRoot && path.basename(resolvedClusterDir).startsWith("naql-ai-phase41-pg-")) {
    let cleanupError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await fs.rm(resolvedClusterDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        cleanupError = undefined;
        break;
      } catch (error) {
        cleanupError = error;
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
    if (cleanupError) failure ??= cleanupError;
  } else if (resolvedClusterDir) {
    failure ??= new Error(`Refusing cleanup outside the isolated test directory: ${clusterDir}`);
  }
}

if (failure) {
  console.error("Isolated Phase 4.1 database suite failed:", failure);
  process.exitCode = 1;
}

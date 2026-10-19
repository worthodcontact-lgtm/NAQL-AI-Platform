/**
 * Secure platform-administrator provisioning.
 *
 * There is intentionally no public endpoint that grants a platform role. This
 * server-side CLI is the only supported way to create the first Super Admin or
 * to recover an administrator account.
 *
 * Usage (from the repository root):
 *   pnpm --filter @naql/api admin -- create --email admin@example.com --name "Platform Admin"
 *   pnpm --filter @naql/api admin -- set-role --email admin@example.com --role ADMIN
 *   pnpm --filter @naql/api admin -- disable --email admin@example.com
 *   pnpm --filter @naql/api admin -- enable --email admin@example.com
 *   pnpm --filter @naql/api admin -- reset-password --email admin@example.com
 *   pnpm --filter @naql/api admin -- list
 *
 * Required environment:
 *   ADMIN_BOOTSTRAP_SECRET  explicit setup secret, at least 16 characters.
 *                           Never commit it; remove it when provisioning is done.
 *   DATABASE_URL            the platform database.
 *
 * The password is read from NAQL_ADMIN_PASSWORD (CI only) or prompted with a
 * masked input. It is never accepted as a command-line argument, logged, or
 * written anywhere.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { recordAudit } from "../src/audit/log.js";
import { PLATFORM_ROLES, PlatformRole } from "../src/auth/permissions.js";
import { isLastActiveSuperAdmin, lockSuperAdminInvariant } from "../src/admin/super-admin.js";

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireBootstrapSecret(): string {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret || secret.trim().length < 16) {
    fail("ADMIN_BOOTSTRAP_SECRET must be set to at least 16 characters for this command");
  }
  if (["changeme", "change-me", "secret", "password", "admin", "bootstrap"].includes(secret.trim().toLowerCase())) {
    fail("ADMIN_BOOTSTRAP_SECRET is too weak; use a long random value");
  }
  if (process.env.JWT_SECRET && secret === process.env.JWT_SECRET) {
    fail("ADMIN_BOOTSTRAP_SECRET must not reuse JWT_SECRET");
  }
  return secret;
}

function requireDatabase() {
  if (!prisma) {
    fail("DATABASE_URL is required; platform administration cannot be provisioned in memory mode");
  }
  return prisma;
}

function parseArgs(argv: string[]) {
  // pnpm forwards the literal `--` separator on some versions; accept both
  // `pnpm admin -- create ...` and `pnpm admin create ...`.
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalized;
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function hiddenPrompt(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY) {
      reject(new Error("stdin is not a TTY; set NAQL_ADMIN_PASSWORD for non-interactive use"));
      return;
    }
    stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("aborted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.NAQL_ADMIN_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < MIN_PASSWORD_LENGTH) {
      fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return fromEnv;
  }

  const first = await hiddenPrompt(`Password (min ${MIN_PASSWORD_LENGTH} characters): `);
  if (first.length < MIN_PASSWORD_LENGTH) fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const second = await hiddenPrompt("Confirm password: ");
  if (first !== second) fail("passwords do not match");
  return first;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "organization"
  );
}

async function findByEmail(email: string) {
  const db = requireDatabase();
  return db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      platformRole: true,
      organizationId: true
    }
  });
}

function normalizeEmail(value: string | undefined): string {
  if (!value) fail("--email is required");
  return value.trim().toLowerCase();
}

function normalizeRole(value: string | undefined): PlatformRole | null {
  if (!value) fail("--role is required (SUPER_ADMIN, ADMIN, REVIEWER, SUPPORT, or none)");
  if (value.toLowerCase() === "none") return null;
  const upper = value.toUpperCase();
  if (!(PLATFORM_ROLES as readonly string[]).includes(upper)) {
    fail(`invalid role: ${value}`);
  }
  return upper as PlatformRole;
}

async function createCommand(options: Record<string, string>) {
  const db = requireDatabase();
  const email = normalizeEmail(options.email);
  const displayName = (options.name ?? "").trim();
  if (displayName.length < 2) fail("--name is required (at least 2 characters)");
  const role = options.role ? normalizeRole(options.role) : "SUPER_ADMIN";
  if (!role) fail("a newly provisioned administrator must have a platform role");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    fail(
      `an account with ${email} already exists; use set-role, enable, or reset-password instead of re-creating it`
    );
  }

  const password = await readPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: `${displayName}'s Organization`, slug: `${slugify(displayName)}-${Date.now()}` }
    });
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName,
        organizationId: organization.id,
        platformRole: role,
        status: "active"
      }
    });
    await tx.membership.create({
      data: { organizationId: organization.id, userId: user.id, role: "ORG_ADMIN" }
    });
    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: "CLI",
        action: "user.platform_role.granted",
        entityType: "User",
        entityId: user.id,
        outcome: "success",
        metadata: { source: "admin-cli", role, email }
      },
      { client: tx, throwOnError: true }
    );
    return user;
  });

  console.log(`created platform administrator ${result.email} with role ${role}`);
}

async function setRoleCommand(options: Record<string, string>) {
  const db = requireDatabase();
  const email = normalizeEmail(options.email);
  const role = normalizeRole(options.role);

  const updated = await db.$transaction(async (tx) => {
    await lockSuperAdminInvariant(tx);
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new Error(`no account found for ${email}`);
    if (user.platformRole === role) throw new Error(`${email} already holds role ${role ?? "none"}`);

    if (user.platformRole === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
      const activeSuperAdminCount = await tx.user.count({
        where: { platformRole: "SUPER_ADMIN", status: "active" }
      });
      if (
        isLastActiveSuperAdmin({
          targetRole: user.platformRole,
          targetStatus: user.status,
          activeSuperAdminCount
        })
      ) {
        throw new Error("refusing to demote the last active Super Admin");
      }
    }

    const result = await tx.user.update({
      where: { id: user.id },
      data: { platformRole: role, sessionVersion: { increment: 1 } }
    });

    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: "CLI",
        action: "user.platform_role.changed",
        entityType: "User",
        entityId: user.id,
        outcome: "success",
        metadata: { source: "admin-cli", from: user.platformRole, to: role, email }
      },
      { client: tx, throwOnError: true }
    );

    return { before: user.platformRole, after: result.platformRole };
  });

  console.log(`updated ${email}: ${updated.before ?? "none"} -> ${updated.after ?? "none"}`);
}

async function setStatusCommand(options: Record<string, string>, status: "active" | "suspended") {
  const db = requireDatabase();
  const email = normalizeEmail(options.email);

  await db.$transaction(async (tx) => {
    await lockSuperAdminInvariant(tx);
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new Error(`no account found for ${email}`);
    if (user.status === status) throw new Error(`${email} is already ${status}`);

    if (status === "suspended") {
      const activeSuperAdminCount = await tx.user.count({
        where: { platformRole: "SUPER_ADMIN", status: "active" }
      });
      if (
        isLastActiveSuperAdmin({
          targetRole: user.platformRole,
          targetStatus: user.status,
          activeSuperAdminCount
        })
      ) {
        throw new Error("refusing to disable the last active Super Admin");
      }
    }

    await tx.user.update({
      where: { id: user.id },
      data: { status, sessionVersion: { increment: 1 } }
    });

    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: "CLI",
        action: status === "suspended" ? "user.suspended" : "user.reactivated",
        entityType: "User",
        entityId: user.id,
        outcome: "success",
        metadata: { source: "admin-cli", email }
      },
      { client: tx, throwOnError: true }
    );
  });

  console.log(`${email} is now ${status}`);
}

async function resetPasswordCommand(options: Record<string, string>) {
  const db = requireDatabase();
  const email = normalizeEmail(options.email);
  const user = await findByEmail(email);
  if (!user) fail(`no account found for ${email}`);

  const password = await readPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } }
    });

    await recordAudit(
      {
        actorUserId: user.id,
        actorRole: "CLI",
        action: "user.password.reset",
        entityType: "User",
        entityId: user.id,
        outcome: "success",
        metadata: { source: "admin-cli", email }
      },
      { client: tx, throwOnError: true }
    );
  });

  console.log(`password reset for ${email}; all existing sessions were revoked`);
}

async function listCommand() {
  const db = requireDatabase();
  const users = await db.user.findMany({
    where: { platformRole: { not: null } },
    select: { id: true, email: true, displayName: true, status: true, platformRole: true, lastLoginAt: true },
    orderBy: [{ platformRole: "asc" }, { email: "asc" }]
  });
  if (users.length === 0) {
    console.log("no platform administrators are provisioned");
    return;
  }
  for (const user of users) {
    console.log(
      `${user.platformRole}\t${user.status}\t${user.email}\t${user.displayName}\tlastLogin=${user.lastLoginAt?.toISOString() ?? "never"}`
    );
  }
}

async function main() {
  // Validating the secret before anything else makes accidental invocation
  // without the explicit authorisation impossible.
  requireBootstrapSecret();

  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command) {
    fail("a command is required: create | set-role | disable | enable | reset-password | list");
  }

  switch (command) {
    case "create":
      await createCommand(options);
      break;
    case "set-role":
      await setRoleCommand(options);
      break;
    case "disable":
      await setStatusCommand(options, "suspended");
      break;
    case "enable":
      await setStatusCommand(options, "active");
      break;
    case "reset-password":
      await resetPasswordCommand(options);
      break;
    case "list":
      await listCommand();
      break;
    default:
      fail(`unknown command: ${command}`);
  }
}

main()
  .catch((error) => {
    // Never print the password or a hash; only the message.
    console.error(`error: ${error instanceof Error ? error.message : "command failed"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });

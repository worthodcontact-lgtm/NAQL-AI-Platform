/**
 * One-time, opt-in import of legacy platform roles.
 *
 * Older builds stored platform staff roles (SUPER_ADMIN, REVIEWER, ...) as
 * rows in `Membership`. That conflated organization membership with platform
 * authority and made privilege accidental. This tool moves those rows to
 * `User.platformRole` without promoting anyone automatically:
 *
 *   pnpm --filter @naql/api admin:import-legacy            # dry run (default)
 *   pnpm --filter @naql/api admin:import-legacy -- --apply # write changes
 *
 * `ADMIN_BOOTSTRAP_SECRET` is required in both modes. Users that already hold a
 * platform role are left untouched. Legacy membership rows are removed only
 * after a successful import; organization roles (ORG_ADMIN, VIEWER, ...) are
 * never touched.
 */
import { prisma } from "../src/db.js";
import { recordAudit } from "../src/audit/log.js";
import { PlatformRole } from "../src/auth/permissions.js";

const LEGACY_ROLE_MAP: Record<string, { role: PlatformRole; rank: number }> = {
  SUPER_ADMIN: { role: "SUPER_ADMIN", rank: 40 },
  ADMIN: { role: "ADMIN", rank: 30 },
  REVIEWER: { role: "REVIEWER", rank: 20 },
  // DATA_OPERATOR was a review helper in earlier builds.
  DATA_OPERATOR: { role: "REVIEWER", rank: 10 }
};

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireBootstrapSecret(): void {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret || secret.trim().length < 16) {
    fail("ADMIN_BOOTSTRAP_SECRET must be set to at least 16 characters");
  }
  if (process.env.JWT_SECRET && secret === process.env.JWT_SECRET) {
    fail("ADMIN_BOOTSTRAP_SECRET must not reuse JWT_SECRET");
  }
}

async function main() {
  requireBootstrapSecret();
  if (!prisma) fail("DATABASE_URL is required");
  const apply = process.argv.slice(2).includes("--apply");

  const legacy = await prisma.membership.findMany({
    where: { role: { in: Object.keys(LEGACY_ROLE_MAP) } },
    select: {
      id: true,
      role: true,
      organizationId: true,
      user: { select: { id: true, email: true, platformRole: true, status: true } }
    }
  });

  if (legacy.length === 0) {
    console.log("no legacy platform-role memberships found");
    return;
  }

  const byUser = new Map<string, { email: string; status: string; platformRole: string | null; roles: typeof legacy }>();
  for (const row of legacy) {
    const entry = byUser.get(row.user.id) ?? {
      email: row.user.email,
      status: row.user.status,
      platformRole: row.user.platformRole,
      roles: [] as typeof legacy
    };
    entry.roles.push(row);
    byUser.set(row.user.id, entry);
  }

  let imported = 0;
  let skipped = 0;

  for (const [userId, entry] of byUser) {
    const best = entry.roles
      .map((row) => LEGACY_ROLE_MAP[row.role])
      .filter(Boolean)
      .sort((a, b) => b.rank - a.rank)[0];

    if (!best) {
      skipped += 1;
      continue;
    }

    if (entry.platformRole) {
      console.log(`skip ${entry.email}: already has platformRole=${entry.platformRole}`);
      skipped += 1;
      continue;
    }

    if (!apply) {
      console.log(`would grant ${best.role} to ${entry.email} (${entry.roles.length} legacy membership row(s))`);
      imported += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { platformRole: best.role, sessionVersion: { increment: 1 } }
      });
      await tx.membership.deleteMany({
        where: { userId, role: { in: Object.keys(LEGACY_ROLE_MAP) } }
      });
    });

    await recordAudit({
      actorUserId: userId,
      actorRole: "CLI",
      action: "user.platform_role.imported",
      entityType: "User",
      entityId: userId,
      outcome: "success",
      metadata: {
        source: "admin-import-legacy",
        role: best.role,
        legacyRoles: entry.roles.map((row) => row.role),
        email: entry.email
      }
    });

    console.log(`granted ${best.role} to ${entry.email}`);
    imported += 1;
  }

  console.log(
    apply
      ? `import complete: ${imported} user(s) updated, ${skipped} skipped`
      : `dry run: ${imported} user(s) would be updated, ${skipped} skipped; re-run with --apply to write`
  );
}

main()
  .catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : "import failed"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });

import type { Prisma } from "@prisma/client";

/** Arbitrary but stable PostgreSQL advisory-lock key for the Super Admin invariant. */
export const SUPER_ADMIN_LOCK_KEY = 710_202_610;

/**
 * Invariant: the platform must always retain at least one active Super Admin.
 *
 * The self-modification rules already stop the only Super Admin from suspending
 * or demoting themselves, and lower roles cannot touch a Super Admin at all.
 * This additional check protects the same invariant from any future code path
 * (CLI, new endpoint, bulk operation).
 */
export function isLastActiveSuperAdmin(input: {
  targetRole: string | null;
  targetStatus: string;
  activeSuperAdminCount: number;
}): boolean {
  return (
    input.targetRole === "SUPER_ADMIN" &&
    input.targetStatus === "active" &&
    input.activeSuperAdminCount <= 1
  );
}

/**
 * Serialize role/suspension changes that can remove an active Super Admin.
 *
 * A plain count-then-update is a TOCTOU race: two concurrent demotions can each
 * observe two Super Admins and both commit, leaving zero. The transaction-scoped
 * advisory lock makes the count and the update one critical section across all
 * API and CLI processes sharing the database.
 */
export async function lockSuperAdminInvariant(tx: Prisma.TransactionClient): Promise<void> {
  // `pg_advisory_xact_lock` returns void, which `$queryRaw` cannot deserialize.
  // `$executeRaw` only needs the command to run and the row to be locked.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK_KEY})`;
}

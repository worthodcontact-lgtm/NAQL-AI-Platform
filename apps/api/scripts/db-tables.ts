import { Prisma } from "@prisma/client";

/**
 * Model delegates in foreign-key-safe order (parents first).
 *
 * Backups are written in this order and restores insert in the same order, so a
 * row never references a parent that has not been created yet. Deletions during
 * a `--replace` restore walk the list backwards.
 *
 * This list is checked against the generated Prisma datamodel before every
 * backup and restore. Adding a model without adding it here fails the command
 * instead of silently producing an incomplete backup.
 */
export const TABLES = [
  "organization",
  "user",
  "membership",
  "companyInvitation",
  "port",
  "company",
  "companyService",
  "companyDocument",
  "verificationReview",
  "shipment",
  "shipmentMilestone",
  "quotationRequest",
  "quotationOffer",
  "document",
  "shipmentParty",
  "auditLog",
  "platformSetting",
  "rfq",
  "rfqRecipient",
  "rfqDocument",
  "quote",
  "quoteItem",
  "bookingRequest",
  "trackingEvent",
  "shipmentEvent",
  "notification",
  "documentExtraction",
  "documentFinding",
  "aiExecution",
  "copilotConversation",
  "copilotMessage",
  "shipmentRiskAssessment",
  "shipmentDelayEstimate"
] as const;

export type TableName = (typeof TABLES)[number];

/** Prisma client delegates derived from the generated datamodel. */
export function requiredModelDelegates(): string[] {
  return Prisma.dmmf.datamodel.models.map(
    (model) => model.name.charAt(0).toLowerCase() + model.name.slice(1)
  );
}

/** Physical PostgreSQL table names that must exist before a backup/restore. */
export function requiredDatabaseTables(): string[] {
  return Prisma.dmmf.datamodel.models.map((model) => (model as any).dbName ?? model.name);
}

/**
 * Fail if the explicit table list and Prisma schema have drifted in either
 * direction. This is the guard that prevents a new model from being omitted.
 */
export function validateTableCoverage(): void {
  const required = requiredModelDelegates();
  const configured = new Set<string>(TABLES);
  const missing = required.filter((delegate) => !configured.has(delegate));
  const unknown = TABLES.filter((delegate) => !required.includes(delegate));
  if (missing.length || unknown.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing model delegates: ${missing.join(", ")}`);
    if (unknown.length) parts.push(`unknown delegates: ${unknown.join(", ")}`);
    throw new Error(`Backup table list is out of date (${parts.join("; ")}). Update db-tables.ts.`);
  }
}

/**
 * Verify the connected database really has every table required by the
 * generated schema. This catches a database that has not had migrations
 * deployed, which would otherwise turn into a silent partial backup.
 */
export async function assertDatabaseSchema(client: any): Promise<void> {
  const rows = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
  `;
  const actual = new Set(rows.map((row: { table_name: string }) => row.table_name));
  const missing = requiredDatabaseTables().filter((table) => !actual.has(table));
  if (missing.length) {
    throw new Error(
      `Database is missing required tables: ${missing.join(", ")}. Run prisma migrate deploy before backing up or restoring.`
    );
  }
}

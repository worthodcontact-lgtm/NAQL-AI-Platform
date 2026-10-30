import { prisma } from "../db.js";
import { recordAudit } from "../audit/log.js";
import { storageAdapter } from "../storage/adapter.js";

/**
 * Retention is a two-step operation: metadata is soft-deleted first, then the
 * stored bytes are removed. A storage failure leaves an inaccessible row rather
 * than an orphaned file that still looks active. Nothing is deleted unless the
 * caller explicitly requests apply mode.
 */
export interface RetentionReport {
  mode: "dry_run" | "apply";
  cutoff: string;
  documents: { eligible: number; deleted: number; errors: number };
  companyDocuments: { eligible: number; deleted: number; errors: number };
}

export async function runRetention(options: {
  apply?: boolean;
  limit?: number;
} = {}): Promise<RetentionReport> {
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(1000, options.limit ?? 200));
  const now = new Date();
  if (!prisma) {
    return {
      mode: apply ? "apply" : "dry_run",
      cutoff: now.toISOString(),
      documents: { eligible: 0, deleted: 0, errors: 0 },
      companyDocuments: { eligible: 0, deleted: 0, errors: 0 }
    };
  }

  const [documents, companyDocuments] = await Promise.all([
    prisma.document.findMany({
      where: { deletedAt: null, retentionUntil: { not: null, lte: now } },
      select: {
        id: true,
        storageKey: true,
        shipmentId: true,
        shipment: { select: { organizationId: true } }
      },
      take: limit
    }),
    prisma.companyDocument.findMany({
      where: { deletedAt: null, retentionUntil: { not: null, lte: now } },
      select: { id: true, storageKey: true, companyId: true, organizationId: true },
      take: limit
    })
  ]);

  const report: RetentionReport = {
    mode: apply ? "apply" : "dry_run",
    cutoff: now.toISOString(),
    documents: { eligible: documents.length, deleted: 0, errors: 0 },
    companyDocuments: { eligible: companyDocuments.length, deleted: 0, errors: 0 }
  };
  if (!apply) return report;

  for (const document of documents) {
    const updated = await prisma.document.updateMany({
      where: { id: document.id, deletedAt: null },
      data: { deletedAt: now, status: "retention_expired" }
    });
    if (updated.count === 0) continue;
    try {
      await storageAdapter.delete(document.storageKey);
      report.documents.deleted += 1;
      await recordAudit({
        organizationId: document.shipment.organizationId,
        action: "document.retention.deleted",
        entityType: "Document",
        entityId: document.id,
        outcome: "success",
        metadata: { shipmentId: document.shipmentId, mode: "retention" }
      });
    } catch {
      report.documents.errors += 1;
    }
  }

  for (const document of companyDocuments) {
    const updated = await prisma.companyDocument.updateMany({
      where: { id: document.id, deletedAt: null },
      data: { deletedAt: now, status: "retention_expired" }
    });
    if (updated.count === 0) continue;
    try {
      await storageAdapter.delete(document.storageKey);
      report.companyDocuments.deleted += 1;
      await recordAudit({
        organizationId: document.organizationId ?? undefined,
        action: "company.document.retention.deleted",
        entityType: "CompanyDocument",
        entityId: document.id,
        outcome: "success",
        metadata: { companyId: document.companyId, mode: "retention" }
      });
    } catch {
      report.companyDocuments.errors += 1;
    }
  }

  return report;
}

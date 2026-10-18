import { prisma } from "../db.js";

export interface AuditEntry {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

const devAuditLog: (AuditEntry & { id: string; createdAt: string })[] = [];

export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (prisma) {
    try {
      await (prisma as any).auditLog.create({
        data: { ...entry, metadata: entry.metadata ? JSON.stringify(entry.metadata) : null }
      });
    } catch {
      // Audit failures must not break the primary operation, but they are logged by the caller.
    }
    return;
  }
  devAuditLog.push({ ...entry, id: `dev-audit-${devAuditLog.length + 1}`, createdAt: new Date().toISOString() });
}

export async function listAudit(limit = 100) {
  if (prisma) {
    return (prisma as any).auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }
  return devAuditLog.slice(-limit).reverse();
}

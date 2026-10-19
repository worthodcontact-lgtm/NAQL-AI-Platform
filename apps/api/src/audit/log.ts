import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditEntry {
  organizationId?: string;
  actorUserId?: string;
  /** Platform role held by the actor at the time of the action. */
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  outcome?: AuditOutcome;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditListQuery {
  limit?: number;
  offset?: number;
  action?: string;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
}

type StoredAudit = Omit<AuditEntry, "metadata"> & {
  id: string;
  outcome: AuditOutcome;
  metadata: string | null;
  createdAt: string;
};

const devAuditLog: StoredAudit[] = [];

/**
 * Keys whose values must never reach the audit log, regardless of caller.
 * This is defence in depth: callers should already avoid passing secrets.
 */
const SENSITIVE_KEY =
  /(password|passphrase|secret|token|authorization|cookie|api[_-]?key|credential|private[_-]?key|hash|otp|session)/i;

const MAX_STRING = 500;

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactAuditValue(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactAuditValue(nested, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…`;
  }
  return value;
}

function serializeMetadata(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null;
  try {
    return JSON.stringify(redactAuditValue(metadata));
  } catch {
    return null;
  }
}

type AuditClient = Prisma.TransactionClient;

/**
 * Persist an audit event.
 *
 * Ordinary callers keep the historical best-effort behaviour so an audit-store
 * outage cannot take down a read path or a login. High-risk mutations pass the
 * surrounding transaction as `client` together with `throwOnError: true`, which
 * makes the business change and its audit row commit atomically.
 */
export async function recordAudit(
  entry: AuditEntry,
  options: { client?: AuditClient; throwOnError?: boolean } = {}
): Promise<boolean> {
  const outcome: AuditOutcome = entry.outcome ?? "success";
  const client = options.client ?? (prisma as AuditClient | null);

  if (client) {
    try {
      await client.auditLog.create({
        data: {
          organizationId: entry.organizationId ?? null,
          actorUserId: entry.actorUserId ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          outcome,
          requestId: entry.requestId ?? null,
          metadata: serializeMetadata(entry.metadata)
        }
      });
      return true;
    } catch (error) {
      if (options.throwOnError) throw error;
      // Never break the primary operation, but make the loss visible to an operator.
      // The event itself contains no secret material.
      console.error("[audit] failed to persist audit event", {
        action: entry.action,
        entityType: entry.entityType,
        outcome
      });
      return false;
    }
  }

  devAuditLog.push({
    ...entry,
    id: `dev-audit-${devAuditLog.length + 1}`,
    outcome,
    metadata: serializeMetadata(entry.metadata),
    createdAt: new Date().toISOString()
  });
  if (devAuditLog.length > 1000) devAuditLog.splice(0, devAuditLog.length - 1000);
  return true;
}

export async function listAudit(query: AuditListQuery = {}) {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  if (prisma) {
    const where: Record<string, unknown> = {};
    if (query.action) where.action = query.action;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.outcome) where.outcome = query.outcome;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {})
      };
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
      prisma.auditLog.count({ where })
    ]);
    return { items, total, limit, offset };
  }

  const filtered = devAuditLog
    .filter((entry) => {
      if (query.action && entry.action !== query.action) return false;
      if (query.actorUserId && entry.actorUserId !== query.actorUserId) return false;
      if (query.entityType && entry.entityType !== query.entityType) return false;
      if (query.entityId && entry.entityId !== query.entityId) return false;
      if (query.outcome && entry.outcome !== query.outcome) return false;
      return true;
    })
    .slice()
    .reverse();

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset
  };
}

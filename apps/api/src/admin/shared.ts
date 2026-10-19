import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { Permission, roleHasPermission } from "../auth/permissions.js";

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
) {
  return reply.code(status).send({ error: message, code, ...extra });
}

/** A business-rule rejection raised inside a transaction and mapped to HTTP safely. */
export class AdminActionError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function sendAdminActionError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdminActionError) {
    return sendError(reply, error.statusCode, error.code, error.message);
  }
  throw error;
}

/**
 * Guard for the administration namespace.
 *
 * - a database is mandatory: platform roles, audit, and suspension live there.
 * - the token must come from `/api/v1/admin/auth/login` (`scope: "admin"`).
 * - the role must hold the exact permission required by the operation.
 *
 * Hiding UI controls is not authorization; every admin route calls this.
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!prisma) {
      return sendError(
        reply,
        503,
        "admin_requires_database",
        "Administration requires the PostgreSQL persistence layer"
      );
    }
    const user = getAuthUser(request);
    if (user.scope !== "admin") {
      return sendError(reply, 403, "admin_session_required", "Administration session required");
    }
    if (!user.platformRole || !roleHasPermission(user.platformRole, permission)) {
      return sendError(reply, 403, "insufficient_permission", "Forbidden");
    }
  };
}

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function pagination(query: { page: number; pageSize: number }): Pagination {
  return {
    page: query.page,
    pageSize: query.pageSize,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize
  };
}

export function pageResult<T>(items: T[], total: number, p: Pagination) {
  return { items, total, page: p.page, pageSize: p.pageSize };
}

/** A query-string date with no time component is interpreted as a whole UTC day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse an administrative date filter.
 *
 * A bare `YYYY-MM-DD` means the *whole* UTC day. Without the end-of-day
 * adjustment, `to=2026-10-19` would resolve to 00:00 and silently omit every
 * record created later that day.
 */
export function parseDate(value?: string, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (endOfDay && DATE_ONLY.test(trimmed)) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

/**
 * Safe user projection. Password hashes and session internals never leave the API.
 */
export const safeUserSelect = {
  id: true,
  email: true,
  displayName: true,
  organizationId: true,
  status: true,
  platformRole: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true, slug: true } },
  memberships: {
    select: { id: true, role: true, organization: { select: { id: true, name: true } } },
    take: 50
  }
} as const;

export function safeMetadata(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

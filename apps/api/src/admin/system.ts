import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, databaseReachable, persistenceMode } from "../db.js";
import { env } from "../config/env.js";
import { getAuthUser } from "../auth/routes.js";
import { can } from "../auth/roles.js";
import { listAudit } from "../audit/log.js";
import { recordAudit } from "../audit/log.js";
import { getIntegrationRegistry } from "../integrations/registry.js";
import {
  AdminActionError,
  listQuerySchema,
  pageResult,
  pagination,
  parseDate,
  requirePermission,
  safeMetadata,
  sendAdminActionError,
  sendError
} from "./shared.js";

const dateParam = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
  .optional();

const auditQuerySchema = listQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorUserId: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(64).optional(),
  outcome: z.enum(["success", "denied", "failure"]).optional(),
  from: dateParam,
  to: dateParam
});

const portsQuerySchema = listQuerySchema.extend({
  country: z.string().trim().max(8).optional(),
  type: z.enum(["seaport", "airport", "inland", "border"]).optional(),
  verificationStatus: z.enum(["approximate", "verified", "unverified"]).optional()
});

const portUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    type: z.enum(["seaport", "airport", "inland", "border"]).optional(),
    source: z.string().trim().max(200).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const SETTING_KEYS = ["platformName", "supportEmail", "maintenanceMessage"] as const;

const settingsUpdateSchema = z
  .object({
    platformName: z.string().trim().min(2).max(80).optional(),
    // An empty string (or null) clears an optional setting instead of failing
    // validation, so administrators can remove a support address or notice.
    supportEmail: z.union([z.string().trim().email().max(120), z.literal(""), z.null()]).optional(),
    maintenanceMessage: z.union([z.string().trim().max(500), z.literal(""), z.null()]).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");

export async function registerAdminSystemRoutes(app: FastifyInstance) {
  // This endpoint intentionally exposes capability status and sanitized evidence only.
  app.get("/api/v1/admin/integrations", { onRequest: [app.authenticate], preHandler: requirePermission("metrics.read") }, async () => {
    return getIntegrationRegistry();
  });

  // ---------------------------------------------------------------- overview
  app.get("/api/v1/admin/overview", { onRequest: [app.authenticate], preHandler: requirePermission("metrics.read") }, async (request, reply) => {
    const db = prisma!;
    const canReadAudit = can(getAuthUser(request), "audit.read");
    try {
      const [
        usersTotal,
        usersActive,
        usersSuspended,
        organizations,
        companies,
        companiesVerified,
        companiesPending,
        shipments,
        shipmentGroups,
        rfqs,
        rfqsPending,
        quotes,
        quotesPending,
        bookings,
        bookingsPending,
        recentAudit
      ] = await Promise.all([
        db.user.count(),
        db.user.count({ where: { status: "active" } }),
        db.user.count({ where: { status: "suspended" } }),
        db.organization.count(),
        db.company.count(),
        db.company.count({ where: { verificationStatus: "verified" } }),
        db.company.count({ where: { verificationStatus: "pending" } }),
        db.shipment.count(),
        db.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
        db.rfq.count(),
        db.rfq.count({ where: { status: "submitted" } }),
        db.quote.count(),
        db.quote.count({ where: { status: "submitted" } }),
        db.bookingRequest.count(),
        db.bookingRequest.count({ where: { status: "requested" } }),
        canReadAudit
          ? db.auditLog.findMany({
              orderBy: { createdAt: "desc" },
              take: 8,
              select: {
                id: true,
                action: true,
                entityType: true,
                entityId: true,
                outcome: true,
                actorUserId: true,
                actorRole: true,
                createdAt: true
              }
            })
          : Promise.resolve([])
      ]);

      const database = await databaseReachable();

      return {
        users: { total: usersTotal, active: usersActive, suspended: usersSuspended },
        organizations: { total: organizations },
        companies: { total: companies, verified: companiesVerified, pending: companiesPending },
        shipments: {
          total: shipments,
          byStatus: shipmentGroups.map((group) => ({ status: group.status, count: group._count._all }))
        },
        rfqs: { total: rfqs, pending: rfqsPending },
        quotes: { total: quotes, pending: quotesPending },
        bookings: { total: bookings, pending: bookingsPending },
        recentAudit,
        recentAuditVisible: canReadAudit,
        health: {
          api: "ok",
          database: database ? "connected" : "unreachable",
          persistenceMode
        },
        generatedAt: new Date().toISOString()
      };
    } catch {
      return sendError(reply, 503, "metrics_unavailable", "Dashboard metrics are currently unavailable");
    }
  });

  // ----------------------------------------------------------------- reports
  app.get("/api/v1/admin/reports", { onRequest: [app.authenticate], preHandler: requirePermission("reports.read") }, async (_request, reply) => {
    const db = prisma!;
    try {
      const [shipments, bookings, rfqs, quotes, companies, topOrganizationGroups, quoteCurrencyGroups] = await Promise.all([
        db.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
        db.bookingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
        db.rfq.groupBy({ by: ["status"], _count: { _all: true } }),
        db.quote.groupBy({ by: ["status"], _count: { _all: true } }),
        db.company.groupBy({ by: ["verificationStatus"], _count: { _all: true } }),
        db.shipment.groupBy({
          by: ["organizationId"],
          _count: { _all: true },
          orderBy: { _count: { organizationId: "desc" } },
          take: 10
        }),
        db.quote.groupBy({ by: ["currency"], _sum: { totalAmount: true }, _count: { _all: true } })
      ]);

      const organizationIds = topOrganizationGroups.map((group) => group.organizationId);
      const organizations = organizationIds.length
        ? await db.organization.findMany({
            where: { id: { in: organizationIds } },
            select: { id: true, name: true }
          })
        : [];
      const nameById = new Map(organizations.map((organization) => [organization.id, organization.name]));

      return {
        shipmentsByStatus: shipments.map((group) => ({ status: group.status, count: group._count._all })),
        bookingsByStatus: bookings.map((group) => ({ status: group.status, count: group._count._all })),
        rfqsByStatus: rfqs.map((group) => ({ status: group.status, count: group._count._all })),
        quotesByStatus: quotes.map((group) => ({ status: group.status, count: group._count._all })),
        companiesByVerification: companies.map((group) => ({
          verificationStatus: group.verificationStatus,
          count: group._count._all
        })),
        topOrganizationsByShipments: topOrganizationGroups.map((group) => ({
          organizationId: group.organizationId,
          name: nameById.get(group.organizationId) ?? null,
          count: group._count._all
        })),
        quoteTotalsByCurrency: quoteCurrencyGroups.map((group) => ({
          currency: group.currency,
          count: group._count._all,
          totalAmount: group._sum.totalAmount
        })),
        generatedAt: new Date().toISOString()
      };
    } catch {
      return sendError(reply, 503, "reports_unavailable", "Reports are currently unavailable");
    }
  });

  // --------------------------------------------------------------- audit logs
  app.get("/api/v1/admin/audit-logs", { onRequest: [app.authenticate], preHandler: requirePermission("audit.read") }, async (request, reply) => {
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const p = pagination({ page: parsed.data.page, pageSize: parsed.data.pageSize });

    const result = await listAudit({
      limit: p.take,
      offset: p.skip,
      action: parsed.data.action,
      actorUserId: parsed.data.actorUserId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      outcome: parsed.data.outcome,
      from: parseDate(parsed.data.from),
      to: parseDate(parsed.data.to, true)
    });

    return {
      items: result.items.map((entry: any) => ({ ...entry, metadata: safeMetadata(entry.metadata) })),
      total: result.total,
      page: p.page,
      pageSize: p.pageSize
    };
  });

  // -------------------------------------------------------------------- ports
  app.get("/api/v1/admin/ports", { onRequest: [app.authenticate], preHandler: requirePermission("ports.read") }, async (request, reply) => {
    const parsed = portsQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "invalid_query", "Invalid query", { issues: parsed.error.issues });
    const { q, country, type, verificationStatus } = parsed.data;
    const p = pagination(parsed.data);
    const db = prisma!;

    const where: any = {};
    if (country) where.country = country;
    if (type) where.type = type;
    if (verificationStatus) where.verificationStatus = verificationStatus;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } }
      ];
    }

    const [items, total] = await Promise.all([
      db.port.findMany({ where, orderBy: [{ country: "asc" }, { name: "asc" }], skip: p.skip, take: p.take }),
      db.port.count({ where })
    ]);

    return pageResult(items, total, p);
  });

  /**
   * Administrative port edits are limited to descriptive metadata.
   * Coordinates are deliberately immutable here: changing them through the API
   * would amount to fabricating geographic data.
   */
  app.patch("/api/v1/admin/ports/:id", { onRequest: [app.authenticate], preHandler: requirePermission("ports.manage") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = portUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

    const actor = getAuthUser(request);
    const db = prisma!;

    const data: any = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.source !== undefined) data.source = parsed.data.source;

    try {
      const updated = await db.$transaction(async (tx) => {
        const before = await tx.port.findUnique({ where: { id } });
        if (!before) throw new AdminActionError(404, "port_not_found", "Port not found");

        const result = await tx.port.update({ where: { id }, data });

        await recordAudit(
          {
            actorUserId: actor.id,
            actorRole: actor.platformRole,
            action: "port.updated",
            entityType: "Port",
            entityId: id,
            outcome: "success",
            requestId: request.id,
            metadata: {
              code: before.code,
              before: { name: before.name, type: before.type, source: before.source },
              after: { name: result.name, type: result.type, source: result.source }
            }
          },
          { client: tx, throwOnError: true }
        );

        return result;
      });

      return { port: updated };
    } catch (error) {
      return sendAdminActionError(reply, error);
    }
  });

  // ----------------------------------------------------------------- settings
  app.get("/api/v1/admin/settings", { onRequest: [app.authenticate], preHandler: requirePermission("settings.read") }, async () => {
    const db = prisma!;
    const rows = await db.platformSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    const database = await databaseReachable();
    const aiProvider = process.env.AI_PROVIDER ?? "none";
    const aiConfigured = Boolean(aiProvider && aiProvider !== "none");

    return {
      platform: {
        platformName: values.platformName ?? "NAQL AI",
        supportEmail: values.supportEmail ?? null,
        maintenanceMessage: values.maintenanceMessage ?? null
      },
      environment: {
        nodeEnv: env.NODE_ENV,
        persistenceMode,
        database: database ? "connected" : "unreachable",
        adminSeparateLogin: true,
        sessionVersioning: true,
        auditLog: true
      },
      integrations: {
        // Configuration presence only. A healthy API does not prove an external
        // provider is reachable, so nothing here is labelled "operational".
        ai: { provider: aiProvider, configured: aiConfigured },
        tradeData: { provider: "UN Comtrade", configured: Boolean(env.COMTRADE_API_KEY) }
      },
      editableKeys: [...SETTING_KEYS]
    };
  });

  app.put("/api/v1/admin/settings", { onRequest: [app.authenticate], preHandler: requirePermission("settings.manage") }, async (request, reply) => {
    const parsed = settingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "invalid_input", "Invalid input", { issues: parsed.error.issues });

    const actor = getAuthUser(request);
    const db = prisma!;
    const changed: Record<string, string | null> = {};

    try {
      await db.$transaction(async (tx) => {
        for (const key of SETTING_KEYS) {
          const value = parsed.data[key];
          if (value === undefined) continue;
          changed[key] = value;

          if (value === null || value === "") {
            await tx.platformSetting.deleteMany({ where: { key } });
          } else {
            await tx.platformSetting.upsert({
              where: { key },
              update: { value, updatedByUserId: actor.id },
              create: { key, value, updatedByUserId: actor.id }
            });
          }
        }

        await recordAudit(
          {
            actorUserId: actor.id,
            actorRole: actor.platformRole,
            action: "settings.updated",
            entityType: "PlatformSetting",
            entityId: "platform",
            outcome: "success",
            requestId: request.id,
            metadata: { changedKeys: Object.keys(changed), values: changed }
          },
          { client: tx, throwOnError: true }
        );
      });

      return { updated: Object.keys(changed) };
    } catch (error) {
      return sendAdminActionError(reply, error);
    }
  });
}

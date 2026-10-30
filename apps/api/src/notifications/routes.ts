import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import {
  notificationDelivery,
  notificationView
} from "./service.js";

function databaseRequired(reply: any) {
  return reply.code(503).send({
    error: "Notifications require the PostgreSQL persistence layer",
    code: "database_required"
  });
}

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/notifications",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!prisma) return databaseRequired(reply);
      const user = getAuthUser(request);
      const parsed = z
        .object({
          page: z.coerce.number().int().min(1).max(1000).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
          unreadOnly: z.enum(["true", "false"]).optional()
        })
        .safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
      }
      const { page, limit, unreadOnly } = parsed.data;
      const where = {
        userId: user.id,
        organizationId: user.organizationId,
        ...(unreadOnly === "true" ? { readAt: null } : {})
      };
      const [items, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
          where: { userId: user.id, organizationId: user.organizationId, readAt: null }
        })
      ]);
      return {
        items: items.map(notificationView),
        total,
        unreadCount,
        page,
        limit,
        hasMore: page * limit < total,
        externalDelivery: {
          provider: notificationDelivery.provider,
          configured: notificationDelivery.configured,
          status: notificationDelivery.configured ? "adapter_configured" : "provider_unavailable"
        }
      };
    }
  );

  app.patch(
    "/api/v1/notifications/:id/read",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!prisma) return databaseRequired(reply);
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const notification = await prisma.notification.findFirst({
        where: { id, userId: user.id, organizationId: user.organizationId }
      });
      if (!notification) return reply.code(404).send({ error: "Notification not found" });
      const updated = await prisma.notification.update({
        where: { id },
        data: { readAt: notification.readAt ?? new Date() }
      });
      return notificationView(updated);
    }
  );

  app.post(
    "/api/v1/notifications/read-all",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!prisma) return databaseRequired(reply);
      const user = getAuthUser(request);
      const result = await prisma.notification.updateMany({
        where: { userId: user.id, organizationId: user.organizationId, readAt: null },
        data: { readAt: new Date() }
      });
      return { updated: result.count };
    }
  );

  app.post(
    "/api/v1/notifications/:id/retry-delivery",
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      if (!prisma) return databaseRequired(reply);
      const user = getAuthUser(request);
      const { id } = request.params as { id: string };
      const notification = await prisma.notification.findFirst({
        where: { id, userId: user.id, organizationId: user.organizationId },
        include: { user: { select: { email: true } } }
      });
      if (!notification) return reply.code(404).send({ error: "Notification not found" });
      if (!notificationDelivery.configured) {
        return reply.code(503).send({
          error: "No external notification provider is configured",
          code: "notification_provider_unavailable",
          inAppPersisted: true
        });
      }
      // The provider request is idempotent on notification id. Returning an
      // already-delivered notification avoids a needless second attempt.
      if (notification.externalDeliveryStatus === "sent") {
        return notificationView(notification);
      }
      try {
        await prisma.notification.update({
          where: { id },
          data: {
            deliveryStatus: "external_queued",
            externalDeliveryStatus: "attempted",
            externalDeliveryAttempts: { increment: 1 },
            externalDeliveryLastAttemptAt: new Date()
          }
        });
        const result = await notificationDelivery.send({
          notificationId: notification.id,
          userId: user.id,
          recipientEmail: notification.user.email,
          title: notification.title,
          body: notification.body
        });
        const updated = await prisma.notification.update({
          where: { id },
          data: {
            deliveryStatus: result.status === "sent" ? "external_sent" : "external_failed",
            externalDeliveryStatus: result.status,
            externalDeliveryError: result.error
          }
        });
        return notificationView(updated);
      } catch {
        await prisma.notification.update({
          where: { id },
          data: {
            deliveryStatus: "external_failed",
            externalDeliveryStatus: "failed",
            externalDeliveryError: "delivery_failed"
          }
        });
        return reply.code(502).send({
          error: "External delivery failed",
          code: "notification_delivery_failed",
          inAppPersisted: true
        });
      }
    }
  );
}

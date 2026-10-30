import { prisma } from "../db.js";
import { emailDelivery } from "./email.js";

/**
 * Persistent in-app notifications.
 *
 * A notification row is created for each authorized recipient before any
 * external attempt. If no provider is configured the row explicitly records
 * `externalDeliveryStatus=provider_unavailable` instead of implying delivery.
 * The optional email adapter is configured only with server-side credentials;
 * its configuration is not proof of delivery.
 */

export type NotificationType =
  | "RFQ_SUBMITTED"
  | "RFQ_CANCELLED"
  | "MARKETPLACE_JOINED"
  | "QUOTATION_RECEIVED"
  | "QUOTATION_ACCEPTED"
  | "QUOTATION_REJECTED"
  | "QUOTATION_WITHDRAWN"
  | "BOOKING_CONFIRMED"
  | "BOOKING_REJECTED"
  | "BOOKING_CANCELLED"
  | "DOCUMENT_FINDINGS"
  | "SHIPMENT_MILESTONE"
  | "RISK_ALERT"
  | "DOCUMENT_UPLOADED";

export interface CreateNotificationInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey: string;
  entityType?: string;
  entityId?: string;
  severity?: "info" | "warning" | "error" | "critical";
  /** Restrict to these active users. Defaults to every active member. */
  recipientUserIds?: string[];
}

export interface NotificationDeliveryAdapter {
  readonly provider: "none" | "email" | "whatsapp";
  readonly configured: boolean;
  send(input: {
    notificationId: string;
    userId: string;
    recipientEmail?: string;
    title: string;
    body: string;
  }): Promise<{ status: "sent" | "provider_unavailable" | "failed"; error?: string }>;
}

export const notificationDelivery: NotificationDeliveryAdapter = {
  provider: emailDelivery.provider === "resend" ? "email" : "none",
  configured: emailDelivery.configured,
  async send(input) {
    if (!input.recipientEmail) {
      return { status: "failed", error: "recipient_email_missing" };
    }
    return emailDelivery.send({
      notificationId: input.notificationId,
      recipientEmail: input.recipientEmail,
      subject: input.title,
      text: input.body
    });
  }
};

async function activeRecipientUsers(
  organizationId: string,
  requested?: string[]
): Promise<Array<{ userId: string; email: string }>> {
  if (!prisma) return [];
  const rows = await prisma.membership.findMany({
    where: {
      organizationId,
      status: "active",
      ...(requested?.length ? { userId: { in: requested } } : {})
    },
    select: { userId: true, user: { select: { email: true } } },
    take: 100
  });
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.userId)) return false;
      seen.add(row.userId);
      return true;
    })
    .map((row) => ({ userId: row.userId, email: row.user.email }));
}

/** Create notification rows. Duplicate dedupe keys are ignored per user. */
export async function notify(input: CreateNotificationInput): Promise<number> {
  if (!prisma) return 0;
  const recipients = await activeRecipientUsers(input.organizationId, input.recipientUserIds);
  if (recipients.length === 0) return 0;

  // createManyAndReturn tells us exactly which rows were inserted. Querying by
  // dedupeKey after a skipDuplicates insert would also return older rows and
  // could send a duplicate external message.
  const created = (await (prisma.notification as any).createManyAndReturn({
    data: recipients.map((recipient) => ({
      organizationId: input.organizationId,
      userId: recipient.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      severity: input.severity ?? "info",
      entityType: input.entityType,
      entityId: input.entityId,
      dedupeKey: input.dedupeKey,
      deliveryStatus: "persisted",
      externalDeliveryStatus: notificationDelivery.configured ? "queued" : "provider_unavailable"
    })),
    skipDuplicates: true
  })) as Array<{ id: string; userId: string }>;

  if (!notificationDelivery.configured || created.length === 0) {
    return created.length;
  }

  const emailByUser = new Map(recipients.map((recipient) => [recipient.userId, recipient.email]));

  // External delivery is deliberately attempted after persistence. A missing
  // or failing provider never removes or hides the durable in-app notification.
  for (const notification of created) {
    const attemptedAt = new Date();
    try {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          deliveryStatus: "external_queued",
          externalDeliveryStatus: "attempted",
          externalDeliveryAttempts: { increment: 1 },
          externalDeliveryLastAttemptAt: attemptedAt
        }
      });
      const delivery = await notificationDelivery.send({
        notificationId: notification.id,
        userId: notification.userId,
        recipientEmail: emailByUser.get(notification.userId),
        title: input.title,
        body: input.body
      });
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          deliveryStatus: delivery.status === "sent" ? "external_sent" : "external_failed",
          externalDeliveryStatus: delivery.status,
          externalDeliveryError: delivery.error
        }
      });
    } catch {
      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          deliveryStatus: "external_failed",
          externalDeliveryStatus: "failed",
          externalDeliveryError: "delivery_failed"
        }
      });
    }
  }

  return created.length;
}

export function notificationView(row: any) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    severity: row.severity,
    entityType: row.entityType,
    entityId: row.entityId,
    read: Boolean(row.readAt),
    readAt: row.readAt,
    deliveryStatus: row.deliveryStatus,
    externalDeliveryStatus: row.externalDeliveryStatus,
    externalDeliveryAttempts: row.externalDeliveryAttempts ?? 0,
    externalDeliveryLastAttemptAt: row.externalDeliveryLastAttemptAt ?? null,
    externalDeliveryError: row.externalDeliveryError ?? null,
    createdAt: row.createdAt
  };
}

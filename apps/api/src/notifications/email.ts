import { emailConfig } from "../config/env.js";

/**
 * Server-side email delivery adapter.
 *
 * The only supported provider is Resend's HTTPS API. The adapter is created
 * from configuration, but `configured` is not proof that messages are
 * deliverable: a verified sender/domain and provider account are still needed.
 * Tests use the factory with a mocked `fetch`; no real credential is required.
 *
 * Privacy: recipient addresses and provider response bodies are never included
 * in returned errors or logs. The notification id is sent as the provider
 * idempotency key so an explicit retry cannot create a duplicate email.
 */

export type EmailDeliveryStatus = "sent" | "provider_unavailable" | "failed";

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  error?: string;
  providerMessageId?: string;
}

export interface EmailDeliveryInput {
  notificationId: string;
  recipientEmail: string;
  subject: string;
  text: string;
}

export interface EmailDeliveryAdapter {
  readonly provider: "none" | "resend";
  readonly configured: boolean;
  send(input: EmailDeliveryInput): Promise<EmailDeliveryResult>;
}

export interface ResendAdapterConfig {
  apiKey?: string;
  from?: string;
  timeoutMs: number;
  endpoint?: string;
}

const unavailable: EmailDeliveryAdapter = {
  provider: "none",
  configured: false,
  async send() {
    return { status: "provider_unavailable" };
  }
};

export function createResendEmailAdapter(config: ResendAdapterConfig): EmailDeliveryAdapter {
  const apiKey = config.apiKey?.trim();
  const from = config.from?.trim();
  const configured = Boolean(apiKey && from);
  const endpoint = config.endpoint ?? "https://api.resend.com/emails";

  return {
    provider: "resend",
    configured,
    async send(input) {
      if (!configured) return { status: "provider_unavailable" };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs));
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": input.notificationId
          },
          body: JSON.stringify({
            from,
            to: [input.recipientEmail],
            subject: input.subject,
            text: input.text
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          return { status: "failed", error: `provider_http_${response.status}` };
        }

        let providerMessageId: string | undefined;
        try {
          const body = (await response.json()) as { id?: unknown };
          if (typeof body?.id === "string" && body.id.length <= 200) {
            providerMessageId = body.id;
          }
        } catch {
          // A successful provider response without a JSON body is still a send.
        }
        return { status: "sent", providerMessageId };
      } catch (error: any) {
        return {
          status: "failed",
          error: error?.name === "AbortError" ? "provider_timeout" : "provider_request_failed"
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export const emailDelivery: EmailDeliveryAdapter =
  emailConfig.provider === "resend"
    ? createResendEmailAdapter({
        apiKey: emailConfig.apiKey,
        from: emailConfig.from,
        timeoutMs: emailConfig.timeoutMs
      })
    : unavailable;

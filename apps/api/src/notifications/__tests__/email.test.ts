import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendEmailAdapter } from "../email.js";

const input = {
  notificationId: "notification-1",
  recipientEmail: "recipient@example.test",
  subject: "Notification subject",
  text: "Notification body"
};

describe("email delivery adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays unavailable without both an API key and a verified sender", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createResendEmailAdapter({ apiKey: "test-key", timeoutMs: 1000 });
    await expect(adapter.send(input)).resolves.toEqual({ status: "provider_unavailable" });
    expect(adapter.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends through the provider with a stable idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "provider-message-1" })
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createResendEmailAdapter({
      apiKey: "test-key",
      from: "NAQL <notifications@example.test>",
      timeoutMs: 1000,
      endpoint: "https://provider.example.test/emails"
    });
    await expect(adapter.send(input)).resolves.toEqual({
      status: "sent",
      providerMessageId: "provider-message-1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://provider.example.test/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.headers["idempotency-key"]).toBe("notification-1");
    expect(JSON.parse(init.body)).toEqual({
      from: "NAQL <notifications@example.test>",
      to: ["recipient@example.test"],
      subject: "Notification subject",
      text: "Notification body"
    });
  });

  it("normalizes provider failures without leaking the recipient address", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const adapter = createResendEmailAdapter({
      apiKey: "test-key",
      from: "notifications@example.test",
      timeoutMs: 1000
    });

    const result = await adapter.send(input);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("provider_http_422");
    expect(JSON.stringify(result)).not.toContain(input.recipientEmail);
  });

  it("reports a timeout as a safe failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }))
    );
    const adapter = createResendEmailAdapter({
      apiKey: "test-key",
      from: "notifications@example.test",
      timeoutMs: 1000
    });

    await expect(adapter.send(input)).resolves.toEqual({
      status: "failed",
      error: "provider_timeout"
    });
  });
});

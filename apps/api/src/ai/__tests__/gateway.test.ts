import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiGateway, redactForLog } from "../gateway.js";

const baseConfig = {
  provider: "openai" as const,
  model: "test-model",
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  timeoutMs: 1000,
  maxRetries: 1
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("AI gateway", () => {
  it("returns an explicit unavailable status in no-provider mode", async () => {
    const gateway = new AiGateway({
      config: { provider: "none", timeoutMs: 1000, maxRetries: 0 },
      fetchImpl: vi.fn()
    });
    const result = await gateway.complete({ operation: "copilot", messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("unavailable");
    expect(result.provider).toBe("none");
    expect(result.errorCode).toBe("ai_provider_not_configured");
    expect(gateway.isConfigured).toBe(false);
  });

  it("parses provider text and usage from an OpenAI-compatible response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 }
      })
    );
    const gateway = new AiGateway({ config: baseConfig, fetchImpl: fetchImpl as any });
    const result = await gateway.complete({ operation: "copilot", messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("completed");
    expect(result.data).toBe("hello");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(4);
    expect(result.attempts).toBe(1);
  });

  it("validates JSON output against the caller's schema", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: JSON.stringify({ count: "not-a-number" }) } }] }));
    const gateway = new AiGateway({ config: baseConfig, fetchImpl: fetchImpl as any });
    const result = await gateway.complete(
      { operation: "document_extract", messages: [{ role: "user", content: "x" }], json: true },
      z.object({ count: z.number() })
    );
    expect(result.status).toBe("validation_failed");
    expect(result.errorCode).toBe("ai_schema_validation_failed");
  });

  it("retries a transient provider failure and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "busy" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const gateway = new AiGateway({
      config: { ...baseConfig, maxRetries: 1 },
      fetchImpl: fetchImpl as any,
      sleep: async () => undefined
    });
    const result = await gateway.complete({ operation: "copilot", messages: [{ role: "user", content: "hi" }] });
    expect(result.status).toBe("completed");
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns timeout without leaking the prompt or key", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const gateway = new AiGateway({
      config: { ...baseConfig, maxRetries: 0 },
      fetchImpl: fetchImpl as any
    });
    const result = await gateway.complete({
      operation: "copilot",
      messages: [{ role: "user", content: "secret document text" }]
    });
    expect(result.status).toBe("timeout");
    expect(result.errorCode).toBe("ai_provider_timeout");
    expect(JSON.stringify(result)).not.toContain("secret document text");
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("redacts credentials, prompts and document content from diagnostics", () => {
    const redacted = redactForLog({
      apiKey: "secret",
      authorization: "Bearer secret",
      prompt: "sensitive",
      content: "document text",
      nested: { token: "secret", operation: "copilot" }
    }) as any;
    expect(redacted.apiKey).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    expect(redacted.prompt).toBe("[redacted]");
    expect(redacted.content).toBe("[redacted]");
    expect(redacted.nested.token).toBe("[redacted]");
    expect(redacted.nested.operation).toBe("copilot");
  });
});

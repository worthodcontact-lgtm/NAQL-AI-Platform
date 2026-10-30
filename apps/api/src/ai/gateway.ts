import type { ZodType } from "zod";
import { aiConfig } from "../config/env.js";

/**
 * Central AI provider gateway.
 *
 * Business code depends on this interface, never on a provider SDK. The
 * deterministic fallbacks in extraction, retrieval, risk and document
 * consistency keep working when no provider is configured.
 *
 * The gateway never logs prompts, document text or credentials. It returns
 * normalized statuses so callers can distinguish "no provider" from "provider
 * failed" and from "the model returned an invalid payload".
 */

export type AiProviderName = "none" | "openai" | "openai-compatible" | "ollama";
export type AiOperation = "copilot" | "document_extract" | "document_classify";
export type AiStatus = "completed" | "unavailable" | "timeout" | "failure" | "validation_failed";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AiCompletionRequest {
  operation: AiOperation;
  messages: AiMessage[];
  /** Ask the provider for JSON output. Callers still validate the result. */
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiCompletionResult<T = string> {
  status: AiStatus;
  provider: AiProviderName;
  model?: string;
  text?: string;
  data?: T;
  usage: AiUsage;
  latencyMs: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface AiGatewayConfig {
  provider: AiProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  maxRetries: number;
}

type FetchLike = typeof fetch;

export interface AiGatewayOptions {
  config?: AiGatewayConfig;
  fetchImpl?: FetchLike;
  /** Injectable for deterministic tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OLLAMA_DEFAULT_BASE = "http://127.0.0.1:11434";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Keep credentials and authorization headers out of any diagnostic output. */
export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog);
  const record = asRecord(value);
  if (!record) return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (/authorization|api[_-]?key|secret|password|token|content|prompt/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactForLog(item);
    }
  }
  return result;
}

function providerConfig(overrides?: Partial<AiGatewayConfig>): AiGatewayConfig {
  return {
    provider: overrides?.provider ?? (aiConfig.provider as AiProviderName),
    model: overrides?.model ?? aiConfig.model,
    apiKey: overrides?.apiKey ?? aiConfig.apiKey,
    baseUrl: overrides?.baseUrl ?? aiConfig.baseUrl,
    timeoutMs: overrides?.timeoutMs ?? aiConfig.timeoutMs,
    maxRetries: overrides?.maxRetries ?? aiConfig.maxRetries
  };
}

function unavailable<T>(config: AiGatewayConfig, errorCode: string, errorMessage: string, started: number): AiCompletionResult<T> {
  return {
    status: "unavailable",
    provider: config.provider,
    model: config.model,
    usage: {},
    latencyMs: Date.now() - started,
    attempts: 0,
    errorCode,
    errorMessage
  };
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function providerUrl(config: AiGatewayConfig): string | null {
  if (config.provider === "openai" || config.provider === "openai-compatible") {
    return `${(config.baseUrl || OPENAI_DEFAULT_BASE).replace(/\/+$/, "")}/chat/completions`;
  }
  if (config.provider === "ollama") {
    return `${(config.baseUrl || OLLAMA_DEFAULT_BASE).replace(/\/+$/, "")}/api/chat`;
  }
  return null;
}

function buildBody(config: AiGatewayConfig, request: AiCompletionRequest) {
  if (config.provider === "ollama") {
    return {
      model: config.model,
      messages: request.messages,
      stream: false,
      ...(request.json ? { format: "json" } : {}),
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined ? { num_predict: request.maxOutputTokens } : {})
      }
    };
  }

  return {
    model: config.model,
    messages: request.messages,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.json ? { response_format: { type: "json_object" } } : {})
  };
}

function parseProviderPayload(provider: AiProviderName, body: unknown): { text?: string; usage: AiUsage } {
  const record = asRecord(body);
  if (!record) return { usage: {} };

  if (provider === "ollama") {
    const message = asRecord(record.message);
    return {
      text: typeof message?.content === "string" ? message.content : undefined,
      usage: {
        inputTokens: numberOrUndefined(record.prompt_eval_count),
        outputTokens: numberOrUndefined(record.eval_count)
      }
    };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  const usage = asRecord(record.usage);
  return {
    text: typeof message?.content === "string" ? message.content : undefined,
    usage: {
      inputTokens: numberOrUndefined(usage?.prompt_tokens),
      outputTokens: numberOrUndefined(usage?.completion_tokens)
    }
  };
}

function safeProviderMessage(body: unknown): string | undefined {
  const record = asRecord(body);
  const error = asRecord(record?.error);
  const message = error?.message ?? record?.message;
  if (typeof message !== "string") return undefined;
  // Provider errors occasionally echo request fragments. Keep the diagnostic short.
  return message.replace(/\s+/g, " ").slice(0, 300);
}

export class AiGateway {
  private readonly config: AiGatewayConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AiGatewayOptions = {}) {
    this.config = providerConfig(options.config);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get provider(): AiProviderName {
    return this.config.provider;
  }

  get model(): string | undefined {
    return this.config.model;
  }

  get isConfigured(): boolean {
    return (
      this.config.provider !== "none" &&
      Boolean(this.config.model) &&
      Boolean(providerUrl(this.config)) &&
      (this.config.provider === "ollama" || Boolean(this.config.apiKey))
    );
  }

  async complete<T = string>(
    request: AiCompletionRequest,
    schema?: ZodType<T>
  ): Promise<AiCompletionResult<T>> {
    const started = Date.now();
    if (!this.isConfigured) {
      return unavailable<T>(
        this.config,
        this.config.provider === "none" ? "ai_provider_not_configured" : "ai_provider_incomplete",
        this.config.provider === "none"
          ? "AI_PROVIDER is none. Deterministic features remain available."
          : "AI provider configuration is incomplete (model, base URL or API key).",
        started
      );
    }

    const url = providerUrl(this.config);
    if (!url) {
      return unavailable<T>(this.config, "ai_provider_unsupported", "Unsupported AI provider.", started);
    }

    const body = buildBody(this.config, request);
    let attempts = 0;
    let lastErrorCode = "ai_provider_failure";
    let lastErrorMessage = "AI provider request failed.";

    while (attempts <= this.config.maxRetries) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.config.provider === "ollama"
              ? {}
              : { authorization: `Bearer ${this.config.apiKey ?? ""}` })
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            payload = undefined;
          }
          lastErrorCode = `ai_provider_http_${response.status}`;
          lastErrorMessage = safeProviderMessage(payload) ?? `AI provider returned HTTP ${response.status}.`;
          if (shouldRetry(response.status) && attempts <= this.config.maxRetries) {
            await this.sleep(Math.min(1000, 150 * 2 ** (attempts - 1)));
            continue;
          }
          return {
            status: "failure",
            provider: this.config.provider,
            model: this.config.model,
            usage: {},
            latencyMs: Date.now() - started,
            attempts,
            errorCode: lastErrorCode,
            errorMessage: lastErrorMessage
          };
        }

        const payload = await response.json();
        const parsed = parseProviderPayload(this.config.provider, payload);
        if (!parsed.text) {
          return {
            status: "failure",
            provider: this.config.provider,
            model: this.config.model,
            usage: parsed.usage,
            latencyMs: Date.now() - started,
            attempts,
            errorCode: "ai_provider_empty_response",
            errorMessage: "AI provider returned no text content."
          };
        }

        let data: T | undefined;
        if (request.json) {
          let json: unknown;
          try {
            json = JSON.parse(parsed.text);
          } catch {
            return {
              status: "validation_failed",
              provider: this.config.provider,
              model: this.config.model,
              text: parsed.text.slice(0, 2000),
              usage: parsed.usage,
              latencyMs: Date.now() - started,
              attempts,
              errorCode: "ai_invalid_json",
              errorMessage: "AI provider did not return valid JSON."
            };
          }

          if (schema) {
            const checked = schema.safeParse(json);
            if (!checked.success) {
              return {
                status: "validation_failed",
                provider: this.config.provider,
                model: this.config.model,
                usage: parsed.usage,
                latencyMs: Date.now() - started,
                attempts,
                errorCode: "ai_schema_validation_failed",
                errorMessage: checked.error.issues
                  .slice(0, 5)
                  .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                  .join("; ")
              };
            }
            data = checked.data;
          } else {
            data = json as T;
          }
        } else {
          data = parsed.text as unknown as T;
        }

        return {
          status: "completed",
          provider: this.config.provider,
          model: this.config.model,
          text: parsed.text,
          data,
          usage: parsed.usage,
          latencyMs: Date.now() - started,
          attempts
        };
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastErrorCode = aborted ? "ai_provider_timeout" : "ai_provider_network_error";
        lastErrorMessage = aborted
          ? `AI provider timed out after ${this.config.timeoutMs}ms.`
          : "AI provider network request failed.";
        if (attempts <= this.config.maxRetries) {
          await this.sleep(Math.min(1000, 150 * 2 ** (attempts - 1)));
          continue;
        }
        return {
          status: aborted ? "timeout" : "failure",
          provider: this.config.provider,
          model: this.config.model,
          usage: {},
          latencyMs: Date.now() - started,
          attempts,
          errorCode: lastErrorCode,
          errorMessage: lastErrorMessage
        };
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      status: "failure",
      provider: this.config.provider,
      model: this.config.model,
      usage: {},
      latencyMs: Date.now() - started,
      attempts,
      errorCode: lastErrorCode,
      errorMessage: lastErrorMessage
    };
  }
}

/** Process-wide default gateway. Tests construct isolated gateways instead. */
export const aiGateway = new AiGateway();

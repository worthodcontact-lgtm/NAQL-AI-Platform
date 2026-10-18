import { env, AI_REQUEST_TIMEOUT_MS } from "../config/env.js";

export interface CopilotRequest {
  question: string;
  context?: Record<string, unknown>;
}

export interface CopilotResult {
  answer: string;
  confidence: number;
  sources: unknown[];
  disclaimer: string;
  providerAvailable: boolean;
}

export interface DelayPredictionRequest {
  route: string;
  mode: string;
  departureDate: string;
  carrier?: string;
}

export interface DelayPredictionResult {
  estimatedDelayDays: number;
  riskLevel: string;
  method: string;
  disclaimer: string;
  providerAvailable: boolean;
}

export async function callCopilot(payload: CopilotRequest): Promise<CopilotResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    const res = await fetch(`${env.AI_SERVICE_URL}/copilot/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { ...json, providerAvailable: true } as CopilotResult;
  } catch {
    return {
      answer: "AI provider unavailable. Configure AI_SERVICE_URL or an LLM provider. This is a labeled development fallback; no model output was generated.",
      confidence: 0,
      sources: [],
      disclaimer: "Fallback, not a verified prediction or fact.",
      providerAvailable: false
    };
  }
}

export async function predictDelay(payload: DelayPredictionRequest): Promise<DelayPredictionResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    const res = await fetch(`${env.AI_SERVICE_URL}/predict/delay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { ...json, providerAvailable: true } as DelayPredictionResult;
  } catch {
    return {
      estimatedDelayDays: 0,
      riskLevel: "unknown",
      method: "fallback-no-provider",
      disclaimer: "No trained model/provider available; not a prediction.",
      providerAvailable: false
    };
  }
}

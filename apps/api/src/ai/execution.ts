import { prisma } from "../db.js";
import type { AiCompletionResult, AiOperation } from "./gateway.js";

/**
 * Persist provider metadata only. Prompts, document text and model output are
 * deliberately excluded so ordinary AI logs cannot leak tenant content.
 */
export async function recordAiExecution(input: {
  organizationId?: string | null;
  userId?: string | null;
  operation: AiOperation;
  result: AiCompletionResult<unknown>;
}): Promise<void> {
  if (!prisma) return;
  try {
    await prisma.aiExecution.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        operation: input.operation,
        provider: input.result.provider,
        model: input.result.model,
        status: input.result.status,
        latencyMs: input.result.latencyMs,
        inputTokens: input.result.usage.inputTokens,
        outputTokens: input.result.usage.outputTokens,
        costUsd: input.result.usage.costUsd,
        errorCode: input.result.errorCode
      }
    });
  } catch {
    // Telemetry must never break the business request.
  }
}

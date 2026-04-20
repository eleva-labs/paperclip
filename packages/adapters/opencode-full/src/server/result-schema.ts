import { z } from "zod";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { opencodeFullSessionParamsSchema } from "./session-codec.js";

export const opencodeFullErrorCodeSchema = z.enum([
  "CONFIG_INVALID",
  "UNAVAILABLE",
  "AUTH_UNRESOLVED",
  "AUTH_REJECTED",
  "HEALTH_FAILED",
  "MODEL_INVALID",
  "SESSION_INVALID_OR_STALE",
  "OWNERSHIP_MISMATCH",
  "TARGET_ISOLATION_FAILED",
  "TIMEOUT",
  "EXECUTION_FAILED",
]);

export const opencodeFullExecutionResultSchema = z.object({
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  signal: z.string().nullable().default(null),
  summary: z.string().nullable().optional(),
  errorCode: opencodeFullErrorCodeSchema.optional(),
  errorMessage: z.string().nullable().optional(),
  errorMeta: z.record(z.unknown()).optional(),
  usage: z.record(z.unknown()).optional(),
  costUsd: z.number().optional(),
  model: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  biller: z.string().nullable().optional(),
  billingType: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  sessionParams: opencodeFullSessionParamsSchema.nullable().optional(),
  sessionDisplayId: z.string().nullable().optional(),
  resultJson: z.record(z.unknown()).optional(),
  clearSession: z.boolean().optional(),
});

function normalizeLegacyErrorCode(rawCode: unknown, rawMessage: unknown): z.infer<typeof opencodeFullErrorCodeSchema> | undefined {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const message = typeof rawMessage === "string" ? rawMessage.trim() : "";
  const normalized = `${code} ${message}`.toLowerCase();

  if (!code && !message) return undefined;
  if (normalized.includes("config_invalid")) return "CONFIG_INVALID";
  if (normalized.includes("auth_unresolved")) return "AUTH_UNRESOLVED";
  if (normalized.includes("auth_rejected")) return "AUTH_REJECTED";
  if (normalized.includes("health_failed") || normalized.includes("unhealthy")) return "HEALTH_FAILED";
  if (normalized.includes("model_invalid")) return "MODEL_INVALID";
  if (normalized.includes("session_invalid") || normalized.includes("unknown session") || normalized.includes("stale")) return "SESSION_INVALID_OR_STALE";
  if (normalized.includes("ownership_mismatch")) return "OWNERSHIP_MISMATCH";
  if (normalized.includes("target_isolation_failed") || normalized.includes("target_mode_unsupported") || normalized.includes("target_mode_requires")) return "TARGET_ISOLATION_FAILED";
  if (normalized.includes("timeout")) return "TIMEOUT";
  if (normalized.includes("session_invalid_or_stale")) return "SESSION_INVALID_OR_STALE";
  if (normalized.includes("unavailable") || normalized.includes("unreachable") || normalized.includes("command_missing") || normalized.includes("not executable")) return "UNAVAILABLE";
  return "EXECUTION_FAILED";
}

export function parseOpencodeFullExecutionResult(raw: unknown): AdapterExecutionResult {
  const input = typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : {};

  if (input.errorCode !== undefined || input.errorMessage !== undefined) {
    input.errorCode = normalizeLegacyErrorCode(input.errorCode, input.errorMessage);
  }

  return opencodeFullExecutionResultSchema.parse(input) as AdapterExecutionResult;
}

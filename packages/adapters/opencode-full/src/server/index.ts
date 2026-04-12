import type {
  AdapterConfigSchema,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterModel,
  AdapterSessionCodec,
} from "@paperclipai/adapter-utils";
import type { ZodIssue } from "zod";
import { opencodeFullRuntimeConfigSchema } from "./config-schema.js";
import { sessionCodec as baseSessionCodec } from "./session-codec.js";
import { getOpencodeFullConfigSchema } from "./config-schema.js";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";

export const sessionCodec: AdapterSessionCodec = baseSessionCodec;

export function getConfigSchema(): AdapterConfigSchema {
  return getOpencodeFullConfigSchema();
}

export async function listOpenCodeFullModels(): Promise<AdapterModel[]> {
  return [
    { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    { id: "openai/gpt-5.2-codex", label: "openai/gpt-5.2-codex" },
    { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
  ];
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const parsed = opencodeFullRuntimeConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    return {
      adapterType: "opencode_full",
      status: "fail",
      testedAt: new Date().toISOString(),
      checks: [{
        code: "opencode_full_config_invalid",
        level: "error",
        message: "Config-only environment check failed schema validation.",
        detail: parsed.error.issues.map((issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      }],
    };
  }

  const mode = parsed.data.executionMode;
  const testedAt = new Date().toISOString();

  if (mode === "remote_server") {
    const target = resolveRemoteTargetIdentity(parsed.data.remoteServer.projectTarget);

    if (target.status === "resolved") {
      return {
        adapterType: "opencode_full",
        status: "pass",
        testedAt,
        checks: [
          {
            code: "opencode_full_config_valid",
            level: "info",
            message: "Config-only environment check passed for executionMode=remote_server.",
            detail: "Cycle 1.1 intentionally keeps testEnvironment() config-only and defers runtime validation.",
          },
          {
            code: "opencode_runtime_target_resolved",
            level: "info",
            message: `Remote target mode ${target.targetMode} is the only Cycle 1.1 target that resolves cleanly in config-only checks.`,
            detail: `resolvedTargetIdentity=${target.resolvedTargetIdentity}`,
          },
        ],
      };
    }

    if (target.status === "conditional") {
      return {
        adapterType: "opencode_full",
        status: "warn",
        testedAt,
        checks: [
          {
            code: "opencode_full_config_valid",
            level: "info",
            message: "Remote server config parsed successfully.",
            detail: "Cycle 1.1 intentionally keeps testEnvironment() config-only and does not claim workspace-aware target readiness.",
          },
          {
            code: "opencode_runtime_target_unsupported",
            level: "warn",
            message: target.message,
            detail: `Selected target mode ${target.targetMode} remains deferred in Cycle 1.1 and cannot be reported as ready by config-only checks.`,
          },
        ],
      };
    }

    return {
      adapterType: "opencode_full",
      status: "fail",
      testedAt,
      checks: [
        {
          code: "opencode_full_config_valid",
          level: "info",
          message: "Remote server config parsed successfully.",
          detail: "Cycle 1.1 intentionally keeps testEnvironment() config-only and does not hide unsupported target modes.",
        },
        {
          code: "opencode_runtime_target_unsupported",
          level: "error",
          message: target.message,
          detail: `Selected target mode ${target.targetMode} is unsupported in Cycle 1.1 and should not be presented as a passing environment check.`,
        },
      ],
    };
  }

  return {
    adapterType: "opencode_full",
    status: mode === "local_sdk" ? "warn" : "pass",
    testedAt,
    checks: [{
      code: mode === "local_sdk" ? "opencode_local_sdk_unavailable" : "opencode_full_config_valid",
      level: mode === "local_sdk" ? "warn" : "info",
      message: mode === "local_sdk"
        ? "local_sdk is a deferred schema branch only and is not executable yet."
        : `Config-only environment check passed for executionMode=${mode}.`,
      detail: "Cycle 1.1 intentionally keeps testEnvironment() config-only and defers runtime validation.",
    }],
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const parsed = opencodeFullRuntimeConfigSchema.parse(ctx.config);
  const suffix = parsed.executionMode === "local_sdk"
    ? "local_sdk is explicitly deferred and is not wired as an executable runtime path."
    : "Runtime execution lands in later cycles; Cycle 1.1 freezes contracts and isolation helpers only.";

  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: parsed.executionMode === "local_sdk" ? "LOCAL_SDK_UNAVAILABLE" : "NOT_IMPLEMENTED",
    errorMessage: `opencode_full ${parsed.executionMode} execution is not available yet. ${suffix}`,
    sessionParams: null,
    sessionDisplayId: null,
    summary: null,
  };
}

export {
  getOpencodeFullConfigSchema,
  opencodeFullExecutionModeSchema,
  opencodeFullLocalCliPersistedConfigSchema,
  opencodeFullLocalSdkPersistedConfigSchema,
  opencodeFullPersistedConfigSchema,
  opencodeFullRemoteAuthPersistedSchema,
  opencodeFullRemoteAuthRuntimeSchema,
  opencodeFullRemoteProjectTargetSchema,
  opencodeFullRemoteServerPersistedConfigSchema,
  opencodeFullRuntimeConfigSchema,
  opencodeFullSharedPersistedConfigSchema,
  type OpencodeFullExecutionMode,
  type OpencodeFullPersistedConfig,
  type OpencodeFullRemoteAuthPersisted,
  type OpencodeFullRemoteAuthRuntime,
  type OpencodeFullRemoteProjectTarget,
  type OpencodeFullRuntimeConfig,
} from "./config-schema.js";
export { buildRemoteAuthHeaders, describePersistedRemoteAuth } from "./remote-auth.js";
export {
  getRemoteTargetMode,
  isRemoteTargetModeResolved,
  resolveRemoteTargetIdentity,
  type RemoteTargetIdentityResolution,
} from "./remote-targeting.js";
export {
  canResumeRemoteSession,
  createRemoteSessionOwnership,
  createRemoteSessionParams,
  getConfigFingerprint,
  opencodeFullRemoteSessionParamsSchema,
  opencodeFullSessionOwnershipSchema,
  type OpencodeFullRemoteSessionParams,
  type OpencodeFullSessionOwnership,
} from "./session-codec.js";

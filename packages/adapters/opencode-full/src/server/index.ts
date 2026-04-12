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
import { deserializeLocalCliSessionParams, executeLocalCli, executeRemoteServer, serializeLocalCliSessionParams } from "./execute.js";
import { discoverRemoteServerOpenCodeModels, listLocalCliOpenCodeModels } from "./models.js";
import { testLocalCliEnvironment, testRemoteServerEnvironment } from "./test.js";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    return deserializeLocalCliSessionParams(raw) ?? baseSessionCodec.deserialize(raw);
  },
  serialize(params: Record<string, unknown> | null) {
    return serializeLocalCliSessionParams(params) ?? baseSessionCodec.serialize(params);
  },
  getDisplayId(params: Record<string, unknown> | null) {
    const local = deserializeLocalCliSessionParams(params);
    if (local) return local.sessionId;
    return baseSessionCodec.getDisplayId?.(params) ?? null;
  },
};

export function getConfigSchema(): AdapterConfigSchema {
  return getOpencodeFullConfigSchema();
}

export async function listOpenCodeFullModels(): Promise<AdapterModel[]> {
  const runtimeConfig = opencodeFullRuntimeConfigSchema.safeParse({
    executionMode: "local_cli",
    model: "openai/gpt-5.4",
    timeoutSec: 120,
    connectTimeoutSec: 10,
    eventStreamIdleTimeoutSec: 30,
    failFastWhenUnavailable: true,
    localCli: {
      command: "opencode",
      allowProjectConfig: true,
      dangerouslySkipPermissions: false,
      graceSec: 5,
      env: {},
    },
  });

  if (runtimeConfig.success) {
    const discovered = await listLocalCliOpenCodeModels(runtimeConfig.data);
    if (discovered.length > 0) return discovered;
  }

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

  if (mode === "local_cli") {
    return testLocalCliEnvironment(ctx, parsed.data);
  }

  if (mode === "remote_server") {
    return testRemoteServerEnvironment(ctx, parsed.data);
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
  if (parsed.executionMode === "local_cli") {
    return executeLocalCli(ctx, parsed);
  }
  if (parsed.executionMode === "remote_server") {
    return executeRemoteServer(ctx, parsed);
  }
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
  type OpencodeFullLocalCliPersistedConfig,
  type OpencodeFullLocalCliRuntimeConfig,
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
export {
  checkRemoteServerHealth,
  discoverLocalCliOpenCodeModels,
  discoverRemoteServerOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  listLocalCliOpenCodeModels,
} from "./models.js";
export {
  deserializeLocalCliSessionParams,
  executeLocalCli,
  executeRemoteServer,
  isOpenCodeUnknownSessionError,
  parseOpenCodeJsonl,
  serializeLocalCliSessionParams,
  type LocalCliSessionParams,
} from "./execute.js";
export { buildRemoteAuthHeaders, describePersistedRemoteAuth, isResolvedRemoteAuth } from "./remote-auth.js";
export {
  getRemoteTargetMode,
  isExecutableRemoteTarget,
  isRemoteTargetModeResolved,
  resolveRemoteTargetIdentity,
  type RemoteTargetIdentityResolution,
} from "./remote-targeting.js";
export {
  canResumeRemoteSession,
  createRemoteSessionOwnership,
  createRemoteSessionParams,
  getConfigFingerprint,
  getRemoteSessionResumeDecision,
  opencodeFullRemoteSessionParamsSchema,
  opencodeFullSessionOwnershipSchema,
  shouldStartFreshRemoteSession,
  type OpencodeFullRemoteSessionParams,
  type OpencodeFullSessionOwnership,
} from "./session-codec.js";
export { prepareLocalCliRuntimeConfig, resetLocalCliOpenCodeModelsCacheForTests } from "./models.js";
export { testLocalCliEnvironment, testRemoteServerEnvironment } from "./test.js";

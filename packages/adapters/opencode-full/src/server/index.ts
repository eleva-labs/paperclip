import type {
  AdapterConfigSchema,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterModel,
} from "@paperclipai/adapter-utils";
import type { ZodIssue } from "zod";
import { sessionCodec } from "./session-codec.js";
import { getOpencodeFullConfigSchema } from "./config-schema.js";
import { executeLocalCli, executeRemoteServer } from "./execute.js";
import { listLocalCliOpenCodeModels } from "./models.js";
import { testLocalCliEnvironment, testRemoteServerEnvironment } from "./test.js";
import { parseOpencodeFullExecutionResult } from "./result-schema.js";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";

export { sessionCodec };

export function getConfigSchema(): AdapterConfigSchema {
  return getOpencodeFullConfigSchema();
}

export async function listModels(): Promise<AdapterModel[]> {
  const runtimeConfig = opencodeFullRuntimeConfigSchema.parse({
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

  if (runtimeConfig.executionMode !== "local_cli") {
    return [
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
      { id: "openai/gpt-5.2-codex", label: "openai/gpt-5.2-codex" },
      { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
    ];
  }

  const discovered = await listLocalCliOpenCodeModels(runtimeConfig);
  if (discovered.length > 0) return discovered;

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
      detail: "testEnvironment() currently stays config-only and defers runtime validation.",
    }],
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const parsed = opencodeFullRuntimeConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    return parseOpencodeFullExecutionResult({
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "CONFIG_INVALID",
      errorMessage: "Execution config failed schema validation.",
      errorMeta: {
        issues: parsed.error.issues.map((issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`),
      },
      sessionParams: null,
      sessionDisplayId: null,
      summary: null,
    });
  }

  if (parsed.data.executionMode === "local_cli") {
    return parseOpencodeFullExecutionResult(await executeLocalCli(ctx, parsed.data));
  }
  if (parsed.data.executionMode === "remote_server") {
    return parseOpencodeFullExecutionResult(await executeRemoteServer(ctx, parsed.data));
  }
  const suffix = parsed.data.executionMode === "local_sdk"
    ? "local_sdk is explicitly deferred and is not wired as an executable runtime path."
    : "This execution mode is not available in the current runtime; only the supported MVP execution paths are executable.";

  return parseOpencodeFullExecutionResult({
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: "UNAVAILABLE",
    errorMessage: `opencode_full ${parsed.data.executionMode} execution is not available yet. ${suffix}`,
    sessionParams: null,
    sessionDisplayId: null,
    summary: null,
  });
}

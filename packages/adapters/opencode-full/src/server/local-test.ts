import os from "node:os";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { ensureCommandResolvable, ensurePathInEnv } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullLocalCliRuntimeConfig } from "./runtime-schema.js";
import {
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
} from "./local-models.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export async function testLocalCliEnvironment(
  _ctx: AdapterEnvironmentTestContext,
  config: OpencodeFullLocalCliRuntimeConfig,
): Promise<AdapterEnvironmentTestResult> {
  const testedAt = new Date().toISOString();
  const checks: AdapterEnvironmentCheck[] = [
    {
      code: "opencode_full_config_valid",
      level: "info",
      message: "Config-only environment check passed for executionMode=local_cli.",
      detail: "This check validates command/model availability from config alone and does not claim workspace-aware runtime readiness.",
    },
  ];

  const cwd = os.tmpdir();
  const configOnlyConfig: OpencodeFullLocalCliRuntimeConfig = {
    ...config,
    localCli: {
      ...config.localCli,
      allowProjectConfig: false,
    },
  };
  const prepared = await prepareLocalCliRuntimeConfig({
    env: normalizeEnv(config.localCli.env),
    config: configOnlyConfig,
    cwd,
  });

  try {
    const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...prepared.env }));

    try {
      await ensureCommandResolvable(config.localCli.command, cwd, runtimeEnv);
      checks.push({
        code: "opencode_local_cli_command_found",
        level: "info",
        message: `Command is executable: ${config.localCli.command}`,
      });
    } catch (err) {
      checks.push({
        code: "opencode_local_cli_command_missing",
        level: "error",
        message: err instanceof Error ? err.message : "Command is not executable",
        detail: config.localCli.command,
        hint: "Install OpenCode locally or point localCli.command at a resolvable binary before relying on local_cli mode.",
      });
      return {
        adapterType: "opencode_full",
        status: summarizeStatus(checks),
        checks,
        testedAt,
      };
    }

    try {
      const models = await discoverLocalCliOpenCodeModels({
        command: config.localCli.command,
        cwd,
        env: runtimeEnv,
        config: configOnlyConfig,
      });
      checks.push({
        code: models.length > 0 ? "opencode_local_cli_models_discovered" : "opencode_local_cli_models_empty",
        level: models.length > 0 ? "info" : "error",
        message: models.length > 0
          ? `Discovered ${models.length} model(s) for local_cli.`
          : "OpenCode returned no models for local_cli.",
        ...(models.length > 0 ? {} : { hint: "Run `opencode models` manually to verify provider auth and local OpenCode config." }),
      });
    } catch (err) {
      checks.push({
        code: "opencode_local_cli_models_failed",
        level: "error",
        message: err instanceof Error ? err.message : "OpenCode model discovery failed.",
        hint: "Run `opencode models` manually to verify provider auth and local OpenCode config.",
      });
    }

    try {
      await ensureLocalCliOpenCodeModelConfiguredAndAvailable({
        model: config.model,
        command: config.localCli.command,
        cwd,
        env: runtimeEnv,
        config: configOnlyConfig,
      });
      checks.push({
        code: "opencode_local_cli_model_valid",
        level: "info",
        message: `Configured model is available for local_cli: ${config.model}`,
      });
    } catch (err) {
      checks.push({
        code: "opencode_local_cli_model_invalid",
        level: "error",
        message: err instanceof Error ? err.message : "Configured model is unavailable.",
        hint: "Choose a currently available OpenCode provider/model ID for local_cli mode.",
      });
    }

    return {
      adapterType: "opencode_full",
      status: summarizeStatus(checks),
      checks,
      testedAt,
    };
  } finally {
    await prepared.cleanup();
  }
}

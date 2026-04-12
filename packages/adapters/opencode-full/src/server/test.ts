import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { ensureCommandResolvable, ensurePathInEnv } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullLocalCliRuntimeConfig, OpencodeFullRemoteServerRuntimeConfig } from "./config-schema.js";
import {
  checkRemoteServerHealth,
  discoverLocalCliOpenCodeModels,
  discoverRemoteServerOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
} from "./models.js";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";

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

function toRemoteHealthFailureCheck(health: Awaited<ReturnType<typeof checkRemoteServerHealth>>): AdapterEnvironmentCheck {
  switch (health.failureKind) {
    case "auth_unresolved":
      return {
        code: "opencode_remote_auth_unresolved",
        level: "error",
        message: health.message,
        detail: health.detail,
        hint: "Resolve remote auth material at runtime before invoking opencode_full remote_server checks.",
      };
    case "auth_rejected":
      return {
        code: "opencode_remote_auth_rejected",
        level: "error",
        message: health.message,
        detail: health.detail,
        hint: "Verify the resolved remote auth credentials accepted by the remote OpenCode server.",
      };
    case "unhealthy":
      return {
        code: "opencode_remote_server_unhealthy",
        level: "error",
        message: health.message,
        detail: health.detail,
        hint: "Verify the remote OpenCode server health endpoint and upstream server status.",
      };
    case "unreachable":
    default:
      return {
        code: "opencode_remote_server_unreachable",
        level: "error",
        message: health.message,
        detail: health.detail,
        hint: "Verify the remote OpenCode server base URL, network reachability, and resolved auth credentials.",
      };
  }
}

export async function testLocalCliEnvironment(
  ctx: AdapterEnvironmentTestContext,
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

  const cwd = process.cwd();
  const prepared = await prepareLocalCliRuntimeConfig({
    env: normalizeEnv(config.localCli.env),
    config,
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
        config,
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
        config,
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

export async function testRemoteServerEnvironment(
  _ctx: AdapterEnvironmentTestContext,
  config: OpencodeFullRemoteServerRuntimeConfig,
): Promise<AdapterEnvironmentTestResult> {
  const testedAt = new Date().toISOString();
  const checks: AdapterEnvironmentCheck[] = [
    {
      code: "opencode_full_config_valid",
      level: "info",
      message: "Config-only environment check passed for executionMode=remote_server.",
      detail: "This check validates reachable/auth/health/model behavior from resolved config alone and does not claim workspace-aware runtime readiness.",
    },
  ];

  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") {
    checks.push({
      code: "opencode_remote_target_not_proven",
      level: target.status === "conditional" ? "warn" : "error",
      message: target.message,
      detail: `Config-only remote_server checks will not approximate target mode ${target.targetMode}.`,
    });
    return { adapterType: "opencode_full", status: summarizeStatus(checks), checks, testedAt };
  }

  const health = await checkRemoteServerHealth(config);
  checks.push(
    health.ok
      ? {
          code: "opencode_remote_server_reachable",
          level: "info",
          message: health.message,
          detail: health.detail,
        }
      : toRemoteHealthFailureCheck(health),
  );

  if (!health.ok) {
    return { adapterType: "opencode_full", status: summarizeStatus(checks), checks, testedAt };
  }

  if (config.remoteServer.requireHealthyServer) {
    checks.push({
      code: "opencode_remote_server_health_ok",
      level: "info",
      message: "Remote server health endpoint accepted the request.",
      detail: "testEnvironment() remains config-only even though it performs remote reachability/auth/health checks.",
    });
  }

  try {
    const models = await discoverRemoteServerOpenCodeModels(config);
    checks.push({
      code: models.length > 0 ? "opencode_remote_models_discovered" : "opencode_remote_models_empty",
      level: models.length > 0 ? "info" : "error",
      message: models.length > 0
        ? `Discovered ${models.length} model(s) from the remote server.`
        : "Remote server returned no models.",
      ...(models.length > 0 ? {} : { hint: "Verify remote OpenCode provider auth and model visibility on the server." }),
    });
  } catch (err) {
    checks.push({
      code: /authentication/i.test(err instanceof Error ? err.message : String(err))
        ? "opencode_remote_auth_rejected"
        : "opencode_remote_models_failed",
      level: "error",
      message: err instanceof Error ? err.message : "Remote model discovery failed.",
      hint: "Verify the resolved remote auth credentials and the remote server's model discovery endpoint.",
    });
    return { adapterType: "opencode_full", status: summarizeStatus(checks), checks, testedAt };
  }

  try {
    await ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config);
    checks.push({
      code: "opencode_remote_model_valid",
      level: "info",
      message: `Configured model is available remotely: ${config.model}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_remote_model_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Configured remote model is unavailable.",
      hint: "Choose a currently available remote OpenCode provider/model ID.",
    });
  }

  return {
    adapterType: "opencode_full",
    status: summarizeStatus(checks),
    checks,
    testedAt,
  };
}

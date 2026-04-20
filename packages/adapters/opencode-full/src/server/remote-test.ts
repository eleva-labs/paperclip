import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";
import { validateResolvedRemoteAuth } from "./remote-auth.js";
import { resolveLinkedRemoteTarget } from "./remote-targeting.js";
import { checkRemoteServerHealth } from "./models.js";
import { ensureRemoteServerOpenCodeModelConfiguredAndAvailable, discoverRemoteServerOpenCodeModels } from "./remote-models.js";

function status(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testRemoteServerEnvironment(
  _ctx: AdapterEnvironmentTestContext,
  config: OpencodeFullRemoteServerRuntimeConfig,
): Promise<AdapterEnvironmentTestResult> {
  const testedAt = new Date().toISOString();
  const checks: AdapterEnvironmentCheck[] = [{
    code: "opencode_full_config_valid",
    level: "info",
    message: "Config-only environment check passed for executionMode=remote_server.",
    detail: "This check validates reachable/auth/health/model behavior from resolved config alone and does not claim workspace-aware runtime readiness.",
  }];

  const auth = validateResolvedRemoteAuth(config.remoteServer.auth);
  if (!auth.ok) {
    checks.push({
      code: "opencode_remote_auth_unresolved",
      level: "error",
      message: auth.reason,
      hint: "Resolve remote auth material at runtime before invoking opencode_full remote_server checks.",
    });
    return { adapterType: "opencode_full", status: status(checks), checks, testedAt };
  }

  const target = resolveLinkedRemoteTarget(config);
  if (target.status !== "resolved") {
    checks.push({
      code: "opencode_remote_target_not_proven",
      level: "error",
      message: target.message,
      detail: `Remote runtime target mode ${target.targetMode} could not be resolved from the current config/runtime metadata.`,
    });
    return { adapterType: "opencode_full", status: status(checks), checks, testedAt };
  }

  const health = await checkRemoteServerHealth(config);
  if (!health.ok) {
    checks.push({
      code: health.failureKind === "auth_rejected"
        ? "opencode_remote_auth_rejected"
        : health.failureKind === "unhealthy"
          ? "opencode_remote_server_unhealthy"
          : "opencode_remote_server_unreachable",
      level: "error",
      message: health.message,
      detail: health.detail,
    });
    return { adapterType: "opencode_full", status: status(checks), checks, testedAt };
  }

  checks.push({
    code: "opencode_remote_server_reachable",
    level: "info",
    message: health.message,
    detail: health.detail,
  });

  try {
    const models = await discoverRemoteServerOpenCodeModels(config);
    checks.push({
      code: models.length > 0 ? "opencode_remote_models_discovered" : "opencode_remote_models_empty",
      level: models.length > 0 ? "info" : "error",
      message: models.length > 0 ? `Discovered ${models.length} model(s) from the remote server.` : "Remote server returned no configured provider/model entries.",
    });
  } catch (err) {
    checks.push({
      code: /authentication/i.test(err instanceof Error ? err.message : String(err)) ? "opencode_remote_auth_rejected" : "opencode_remote_models_failed",
      level: "error",
      message: err instanceof Error ? err.message : "Remote model discovery failed.",
    });
    return { adapterType: "opencode_full", status: status(checks), checks, testedAt };
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
      message: err instanceof Error ? err.message : "Configured remote OpenCode model is unavailable.",
    });
  }

  return { adapterType: "opencode_full", status: status(checks), checks, testedAt };
}

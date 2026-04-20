import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asString,
  asStringArray,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  parseJson,
  parseObject,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { discoverProjectAwareOpenCodeModels, ensureProjectAwareOpenCodeModelConfiguredAndAvailable } from "./models.js";
import { prepareProjectAwareOpenCodeRuntimeConfig } from "./runtime-config.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 239)}...` : clean;
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = parseObject(value);
  const message = asString(record.message, "").trim();
  if (message) return message;
  const data = parseObject(record.data);
  const nestedMessage = asString(data.message, "").trim();
  if (nestedMessage) return nestedMessage;
  return asString(record.code, "").trim();
}

function parseOpenCodeJsonl(stdout: string) {
  let summary = "";
  let errorMessage: string | null = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;
    if (asString(event.type, "") === "text") {
      const text = asString(parseObject(event.part).text, "").trim();
      if (text) summary = summary ? `${summary}\n\n${text}` : text;
    }
    if (asString(event.type, "") === "error") {
      const text = errorText(event.error ?? event.message).trim();
      if (text) errorMessage = errorMessage ? `${errorMessage}\n${text}` : text;
    }
  }
  return { summary, errorMessage };
}

const OPENCODE_AUTH_REQUIRED_RE =
  /(?:auth(?:entication)?\s+required|api\s*key|invalid\s*api\s*key|not\s+logged\s+in|opencode\s+auth\s+login|free\s+usage\s+exceeded)/i;

function resolveEnvironmentTestRuntimeMetadata(config: Record<string, unknown>) {
  const configuredCwd = asString(config.cwd, "").trim();
  const canonicalWorkspaceOnly = asBoolean(config.canonicalWorkspaceOnly, false);
  const cwd = configuredCwd || process.cwd();

  return {
    cwd,
    canonicalWorkspaceId: null,
    canonicalWorkspaceCwd: null,
    executionWorkspaceId: null,
    executionWorkspaceSource: "adapter_fallback" as const,
    metadataCheck: canonicalWorkspaceOnly
      ? ({
          code: "opencode_project_runtime_metadata_unavailable",
          level: "error",
          message:
            "Canonical workspace diagnostics are unavailable through the standard adapter test route because it only provides adapter config, not live Paperclip workspace metadata.",
          detail: JSON.stringify(
            {
              configuredFallbackCwd: configuredCwd || null,
              resolvedExecutionCwd: cwd,
              canonicalWorkspaceOnly,
              hostPath: "adapter_config_only",
            },
            null,
            2,
          ),
          hint:
            "Run this adapter through a real agent/workspace invocation to validate canonical-only runtime behavior, or disable canonicalWorkspaceOnly for bare CLI environment checks.",
        } satisfies AdapterEnvironmentCheck)
      : ({
          code: "opencode_project_runtime_metadata",
          level: "info",
          message: `Resolved execution cwd from adapter config fallback: ${cwd}`,
          detail: JSON.stringify(
            {
              canonicalWorkspaceId: null,
              canonicalWorkspaceCwd: null,
              executionWorkspaceId: null,
              executionWorkspaceSource: "adapter_fallback",
              configuredFallbackCwd: configuredCwd || null,
              hostPath: "adapter_config_only",
            },
            null,
            2,
          ),
        } satisfies AdapterEnvironmentCheck),
  };
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "opencode");
  const executionContext = resolveEnvironmentTestRuntimeMetadata(config);
  const cwd = executionContext.cwd;

  checks.push(executionContext.metadataCheck);

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: false });
    checks.push({
      code: "opencode_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "opencode_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  const preparedRuntimeConfig = await prepareProjectAwareOpenCodeRuntimeConfig({ env, config, cwd });
  if (asBoolean(config.allowProjectConfig, true)) {
    checks.push({
      code: "opencode_project_config_enabled",
      level: "info",
      message: "Repo-local OpenCode project config is enabled for this adapter type unless explicitly overridden in env.",
    });
  }
  if (asBoolean(config.dangerouslySkipPermissions, true)) {
    checks.push({
      code: "opencode_headless_permissions_enabled",
      level: "info",
      message: "Headless OpenCode external-directory permissions are auto-approved for unattended runs.",
    });
  }

  try {
    const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...preparedRuntimeConfig.env }));
    const cwdInvalid = checks.some((check) => check.code === "opencode_cwd_invalid");
    if (cwdInvalid) {
      checks.push({
        code: "opencode_command_skipped",
        level: "warn",
        message: "Skipped command check because working directory validation failed.",
        detail: command,
      });
    } else {
      try {
        await ensureCommandResolvable(command, cwd, runtimeEnv);
        checks.push({
          code: "opencode_command_resolvable",
          level: "info",
          message: `Command is executable: ${command}`,
        });
      } catch (err) {
        checks.push({
          code: "opencode_command_unresolvable",
          level: "error",
          message: err instanceof Error ? err.message : "Command is not executable",
          detail: command,
        });
      }
    }

    const canRunProbe =
      checks.every((check) => check.code !== "opencode_cwd_invalid" && check.code !== "opencode_command_unresolvable");
    const configuredModel = asString(config.model, "").trim();
    let modelValidationPassed = false;

    if (canRunProbe) {
      try {
        const discovered = await discoverProjectAwareOpenCodeModels({
          command,
          cwd,
          env: runtimeEnv,
          config,
          runtimeMetadata: {
            canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
            canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
            executionWorkspaceId: executionContext.executionWorkspaceId,
            executionWorkspaceSource: executionContext.executionWorkspaceSource,
          },
        });
        checks.push({
          code: discovered.length > 0 ? "opencode_models_discovered" : "opencode_models_empty",
          level: discovered.length > 0 ? "info" : "error",
          message:
            discovered.length > 0
              ? `Discovered ${discovered.length} model(s) from OpenCode providers.`
              : "OpenCode returned no models.",
          ...(discovered.length > 0 ? {} : { hint: "Run `opencode models` and verify provider authentication." }),
        });
      } catch (err) {
        checks.push({
          code: "opencode_models_discovery_failed",
          level: configuredModel ? "error" : "warn",
          message: err instanceof Error ? err.message : "OpenCode model discovery failed.",
          hint: "Run `opencode models` manually to verify provider auth and config.",
        });
      }
    }

    if (configuredModel && canRunProbe) {
      try {
        await ensureProjectAwareOpenCodeModelConfiguredAndAvailable({
          model: configuredModel,
          command,
          cwd,
          env: runtimeEnv,
          config,
          runtimeMetadata: {
            canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
            canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
            executionWorkspaceId: executionContext.executionWorkspaceId,
            executionWorkspaceSource: executionContext.executionWorkspaceSource,
          },
        });
        checks.push({
          code: "opencode_model_configured",
          level: "info",
          message: `Configured model: ${configuredModel}`,
        });
        modelValidationPassed = true;
      } catch (err) {
        checks.push({
          code: "opencode_model_invalid",
          level: "error",
          message: err instanceof Error ? err.message : "Configured model is unavailable.",
          hint: "Run `opencode models` and choose a currently available provider/model ID.",
        });
      }
    }

    if (canRunProbe && modelValidationPassed) {
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();
      const variant = asString(config.variant, "").trim();
      const args = ["run", "--format", "json", "--model", configuredModel];
      if (variant) args.push("--variant", variant);
      if (extraArgs.length > 0) args.push(...extraArgs);

      try {
        const probe = await runChildProcess(
          `opencode-project-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          command,
          args,
          {
            cwd,
            env: runtimeEnv,
            timeoutSec: 60,
            graceSec: 5,
            stdin: "Respond with hello.",
            onLog: async () => {},
          },
        );
        const parsed = parseOpenCodeJsonl(probe.stdout);
        const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);
        const authEvidence = `${parsed.errorMessage ?? ""}\n${probe.stdout}\n${probe.stderr}`.trim();

        if (probe.timedOut) {
          checks.push({
            code: "opencode_hello_probe_timed_out",
            level: "warn",
            message: "OpenCode hello probe timed out.",
            hint: "Retry the probe. If this persists, run OpenCode manually in this working directory.",
          });
        } else if ((probe.exitCode ?? 1) === 0 && !parsed.errorMessage) {
          const summary = parsed.summary.trim();
          const hasHello = /\bhello\b/i.test(summary);
          checks.push({
            code: hasHello ? "opencode_hello_probe_passed" : "opencode_hello_probe_unexpected_output",
            level: hasHello ? "info" : "warn",
            message: hasHello
              ? "OpenCode hello probe succeeded."
              : "OpenCode probe ran but did not return `hello` as expected.",
            ...(summary ? { detail: summary.replace(/\s+/g, " ").trim().slice(0, 240) } : {}),
          });
        } else if (OPENCODE_AUTH_REQUIRED_RE.test(authEvidence)) {
          checks.push({
            code: "opencode_hello_probe_auth_required",
            level: "warn",
            message: "OpenCode is installed, but provider authentication is not ready.",
            ...(detail ? { detail } : {}),
            hint: "Run `opencode auth login` or set provider credentials, then retry the probe.",
          });
        } else {
          checks.push({
            code: "opencode_hello_probe_failed",
            level: "error",
            message: "OpenCode hello probe failed.",
            ...(detail ? { detail } : {}),
            hint: "Run `opencode run --format json` manually in this working directory to debug.",
          });
        }
      } catch (err) {
        checks.push({
          code: "opencode_hello_probe_failed",
          level: "error",
          message: "OpenCode hello probe failed.",
          detail: err instanceof Error ? err.message : String(err),
          hint: "Run `opencode run --format json` manually in this working directory to debug.",
        });
      }
    }
  } finally {
    await preparedRuntimeConfig.cleanup();
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

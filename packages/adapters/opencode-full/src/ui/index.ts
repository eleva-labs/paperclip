import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export { parseOpenCodeFullStdoutLine as parseStdoutLine } from "../ui-parser.js";

function parseJsonObject(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function buildOpenCodeFullConfig(values: CreateConfigValues): Record<string, unknown> {
  const raw = values.adapterSchemaValues ?? {};
  const executionMode = typeof raw.executionMode === "string" ? raw.executionMode : "local_cli";

  const config: Record<string, unknown> = {
    executionMode,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : values.model,
  };

  if (typeof raw.variant === "string" && raw.variant.trim()) config.variant = raw.variant.trim();
  if (typeof raw.promptTemplate === "string") config.promptTemplate = raw.promptTemplate;
  if (typeof raw.bootstrapPromptTemplate === "string") config.bootstrapPromptTemplate = raw.bootstrapPromptTemplate;
  if (typeof raw.timeoutSec === "number") config.timeoutSec = raw.timeoutSec;
  if (typeof raw.connectTimeoutSec === "number") config.connectTimeoutSec = raw.connectTimeoutSec;
  if (typeof raw.eventStreamIdleTimeoutSec === "number") config.eventStreamIdleTimeoutSec = raw.eventStreamIdleTimeoutSec;
  if (typeof raw.failFastWhenUnavailable === "boolean") config.failFastWhenUnavailable = raw.failFastWhenUnavailable;

  if (executionMode === "local_cli") {
    config.localCli = {
      command: raw["localCli.command"] ?? "opencode",
      allowProjectConfig: raw["localCli.allowProjectConfig"] ?? true,
      dangerouslySkipPermissions: raw["localCli.dangerouslySkipPermissions"] ?? false,
      graceSec: raw["localCli.graceSec"] ?? 5,
      env: parseJsonObject(raw["localCli.env"]),
    };
  } else if (executionMode === "remote_server") {
    const parsedRemoteTarget = parseJsonObject(raw["remoteServer.projectTarget"]);
    const remoteTargetMode = typeof raw["remoteServer.projectTarget.mode"] === "string"
      ? raw["remoteServer.projectTarget.mode"]
      : undefined;
    config.remoteServer = {
      baseUrl: raw["remoteServer.baseUrl"],
      auth: parseJsonObject(raw["remoteServer.auth"]) ?? { mode: "none" },
      healthTimeoutSec: raw["remoteServer.healthTimeoutSec"] ?? 10,
      requireHealthyServer: raw["remoteServer.requireHealthyServer"] ?? true,
      projectTarget: parsedRemoteTarget ?? { mode: remoteTargetMode ?? "server_default" },
    };
  } else if (executionMode === "local_sdk") {
    config.localSdk = {
      sdkProviderHint: raw["localSdk.sdkProviderHint"],
      allowProjectConfig: raw["localSdk.allowProjectConfig"] ?? true,
      env: parseJsonObject(raw["localSdk.env"]),
    };
  }

  return config;
}

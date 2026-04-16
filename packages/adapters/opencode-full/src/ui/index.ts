import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export { parseOpenCodeFullStdoutLine as parseStdoutLine } from "../ui-parser.js";

export const DEFAULT_OPENCODE_FULL_MODEL = "openai/gpt-5.4";

export type OpenCodeFullDerivedRemoteUiState = {
  executionMode: "remote_server";
  baseUrl: string | null;
  authMode: "none" | "bearer" | "basic" | "header" | "unknown";
  targetMode: "server_default" | "linked_project_context" | "unknown";
  canonicalWorkspaceId: string | null;
  linkedDirectoryHint: string | null;
  pluginDerived: boolean;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asEnvBinding(value: unknown): string | Record<string, unknown> | undefined {
  if (typeof value === "string") {
    return value.trim() ? value.trim() : undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "plain" && typeof record.value === "string") {
    return { type: "plain", value: record.value };
  }
  if (record.type === "secret_ref" && typeof record.secretId === "string") {
    return {
      type: "secret_ref",
      secretId: record.secretId,
      ...(typeof record.version === "number" || record.version === "latest"
        ? { version: record.version }
        : {}),
    };
  }

  return undefined;
}

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

function parseRemoteAuth(raw: Record<string, unknown>): Record<string, unknown> {
  const authMode = typeof raw["remoteServer.auth.mode"] === "string"
    ? raw["remoteServer.auth.mode"]
    : undefined;

  if (authMode === "bearer") {
    return {
      mode: "bearer",
      token: asEnvBinding(raw["remoteServer.auth.token"]) ?? "",
    };
  }

  if (authMode === "basic") {
    return {
      mode: "basic",
      username: asNonEmptyString(raw["remoteServer.auth.username"]) ?? "",
      password: asEnvBinding(raw["remoteServer.auth.password"]) ?? "",
    };
  }

  if (authMode === "header") {
    return {
      mode: "header",
      headerName: asNonEmptyString(raw["remoteServer.auth.headerName"]) ?? "",
      headerValue: asEnvBinding(raw["remoteServer.auth.headerValue"]) ?? "",
    };
  }

  return parseJsonObject(raw["remoteServer.auth"]) ?? { mode: "none" };
}

export function buildOpenCodeFullConfig(values: CreateConfigValues): Record<string, unknown> {
  const raw = values.adapterSchemaValues ?? {};
  const executionMode = typeof raw.executionMode === "string" ? raw.executionMode : "local_cli";

  const config: Record<string, unknown> = {
    executionMode,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : values.model,
    timeoutSec: typeof raw.timeoutSec === "number" ? raw.timeoutSec : 120,
    connectTimeoutSec: typeof raw.connectTimeoutSec === "number" ? raw.connectTimeoutSec : 10,
    eventStreamIdleTimeoutSec:
      typeof raw.eventStreamIdleTimeoutSec === "number"
        ? raw.eventStreamIdleTimeoutSec
        : 30,
    failFastWhenUnavailable:
      typeof raw.failFastWhenUnavailable === "boolean"
        ? raw.failFastWhenUnavailable
        : true,
  };

  if (typeof raw.variant === "string" && raw.variant.trim()) config.variant = raw.variant.trim();
  if (typeof raw.promptTemplate === "string") config.promptTemplate = raw.promptTemplate;
  if (typeof raw.bootstrapPromptTemplate === "string") config.bootstrapPromptTemplate = raw.bootstrapPromptTemplate;

  if (executionMode === "local_cli") {
    config.localCli = {
      command: raw["localCli.command"] ?? "opencode",
      allowProjectConfig: raw["localCli.allowProjectConfig"] ?? true,
      dangerouslySkipPermissions: raw["localCli.dangerouslySkipPermissions"] ?? false,
      graceSec: raw["localCli.graceSec"] ?? 5,
      env: parseJsonObject(raw["localCli.env"]) ?? {},
    };
  } else if (executionMode === "remote_server") {
    config.remoteServer = {
      baseUrl: raw["remoteServer.baseUrl"],
      auth: parseRemoteAuth(raw),
      healthTimeoutSec: raw["remoteServer.healthTimeoutSec"] ?? 10,
      requireHealthyServer: raw["remoteServer.requireHealthyServer"] ?? true,
      projectTarget: {
        mode: typeof raw["remoteServer.projectTarget.mode"] === "string"
          ? raw["remoteServer.projectTarget.mode"]
          : "server_default",
      },
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

export function getOpenCodeFullDerivedRemoteUiState(
  config: unknown,
): OpenCodeFullDerivedRemoteUiState | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return null;
  }

  const record = config as Record<string, unknown>;
  if (record.executionMode !== "remote_server") {
    return null;
  }

  const remoteServer =
    typeof record.remoteServer === "object" && record.remoteServer !== null && !Array.isArray(record.remoteServer)
      ? (record.remoteServer as Record<string, unknown>)
      : null;

  const auth =
    remoteServer && typeof remoteServer.auth === "object" && remoteServer.auth !== null && !Array.isArray(remoteServer.auth)
      ? (remoteServer.auth as Record<string, unknown>)
      : null;
  const projectTarget =
    remoteServer && typeof remoteServer.projectTarget === "object" && remoteServer.projectTarget !== null && !Array.isArray(remoteServer.projectTarget)
      ? (remoteServer.projectTarget as Record<string, unknown>)
      : null;
  const linkRef =
    remoteServer && typeof remoteServer.linkRef === "object" && remoteServer.linkRef !== null && !Array.isArray(remoteServer.linkRef)
      ? (remoteServer.linkRef as Record<string, unknown>)
      : null;

  const authMode = auth?.mode;
  const targetMode = projectTarget?.mode;

  return {
    executionMode: "remote_server",
    baseUrl: asNonEmptyString(remoteServer?.baseUrl) ?? null,
    authMode:
      authMode === "none" || authMode === "bearer" || authMode === "basic" || authMode === "header"
        ? authMode
        : "unknown",
    targetMode:
      targetMode === "server_default" || targetMode === "linked_project_context"
        ? targetMode
        : "unknown",
    canonicalWorkspaceId: asNonEmptyString(linkRef?.canonicalWorkspaceId) ?? null,
    linkedDirectoryHint: asNonEmptyString(linkRef?.linkedDirectoryHint) ?? null,
    pluginDerived: targetMode === "linked_project_context" && linkRef !== null,
  };
}

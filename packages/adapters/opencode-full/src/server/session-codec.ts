import { z } from "zod";
import { opencodeFullRuntimeConfigSchema } from "./config-schema.js";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!isRecord(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stableNormalize(value[key]);
      return acc;
    }, {});
}

/**
 * Deterministic fingerprint for remote/session isolation.
 *
 * This intentionally covers only resolved runtime fields that must invalidate
 * remote resume when they change: executionMode, shared execution inputs,
 * remote base URL, resolved auth material, and resolved target config.
 */
export function getConfigFingerprint(rawConfig: unknown): string {
  const config = opencodeFullRuntimeConfigSchema.parse(rawConfig);
  const normalized = stableNormalize(config);
  return JSON.stringify(normalized);
}

export const opencodeFullSessionOwnershipSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  adapterType: z.literal("opencode_full"),
  executionMode: z.enum(["local_cli", "remote_server", "local_sdk"]),
  configFingerprint: z.string().min(1),
});

export const opencodeFullRemoteSessionParamsSchema = z.object({
  ownership: opencodeFullSessionOwnershipSchema.extend({
    executionMode: z.literal("remote_server"),
  }),
  baseUrl: z.string().url(),
  remoteSessionId: z.string().min(1),
  projectTargetMode: z.enum([
    "server_default",
    "paperclip_workspace",
    "server_managed_namespace",
    "fixed_path",
  ]),
  resolvedTargetIdentity: z.string().min(1),
  canonicalWorkspaceId: z.string().min(1).nullable(),
  canonicalWorkspaceCwd: z.string().min(1).nullable(),
  serverScope: z.enum(["shared", "dedicated_single_company", "unknown"]),
  createdAt: z.string().datetime(),
});

export type OpencodeFullRemoteSessionParams = z.infer<typeof opencodeFullRemoteSessionParamsSchema>;
export type OpencodeFullSessionOwnership = z.infer<typeof opencodeFullSessionOwnershipSchema>;

export function createRemoteSessionOwnership(input: {
  companyId: string;
  agentId: string;
  config: unknown;
}): OpencodeFullSessionOwnership {
  const config = opencodeFullRuntimeConfigSchema.parse(input.config);
  return {
    companyId: input.companyId,
    agentId: input.agentId,
    adapterType: "opencode_full",
    executionMode: config.executionMode,
    configFingerprint: getConfigFingerprint(config),
  };
}

export function createRemoteSessionParams(input: {
  companyId: string;
  agentId: string;
  config: unknown;
  remoteSessionId: string;
  canonicalWorkspaceId?: string | null;
  canonicalWorkspaceCwd?: string | null;
  serverScope?: "shared" | "dedicated_single_company" | "unknown";
  createdAt?: string;
}): OpencodeFullRemoteSessionParams {
  const config = opencodeFullRuntimeConfigSchema.parse(input.config);
  if (config.executionMode !== "remote_server") {
    throw new Error("createRemoteSessionParams requires executionMode=remote_server");
  }

  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") {
    throw new Error(target.message);
  }

  return {
    ownership: {
      ...createRemoteSessionOwnership(input),
      executionMode: "remote_server",
    },
    baseUrl: config.remoteServer.baseUrl,
    remoteSessionId: input.remoteSessionId,
    projectTargetMode: target.targetMode,
    resolvedTargetIdentity: target.resolvedTargetIdentity,
    canonicalWorkspaceId: input.canonicalWorkspaceId ?? null,
    canonicalWorkspaceCwd: input.canonicalWorkspaceCwd ?? null,
    serverScope: input.serverScope ?? "unknown",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function canResumeRemoteSession(input: {
  companyId: string;
  agentId: string;
  config: unknown;
  sessionParams: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const config = opencodeFullRuntimeConfigSchema.parse(input.config);
  const session = opencodeFullRemoteSessionParamsSchema.safeParse(input.sessionParams);

  if (!session.success) return { ok: false, reason: "invalid_remote_session_params" };
  if (config.executionMode !== "remote_server") return { ok: false, reason: "execution_mode_mismatch" };

  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") return { ok: false, reason: target.code };

  const expectedFingerprint = getConfigFingerprint(config);
  const checks: Array<[boolean, string]> = [
    [session.data.ownership.companyId === input.companyId, "company_id_mismatch"],
    [session.data.ownership.agentId === input.agentId, "agent_id_mismatch"],
    [session.data.ownership.adapterType === "opencode_full", "adapter_type_mismatch"],
    [session.data.ownership.executionMode === "remote_server", "execution_mode_mismatch"],
    [session.data.ownership.configFingerprint === expectedFingerprint, "config_fingerprint_mismatch"],
    [session.data.baseUrl === config.remoteServer.baseUrl, "base_url_mismatch"],
    [session.data.projectTargetMode === target.targetMode, "target_mode_mismatch"],
    [session.data.resolvedTargetIdentity === target.resolvedTargetIdentity, "resolved_target_identity_mismatch"],
  ];

  for (const [ok, reason] of checks) {
    if (!ok) return { ok: false, reason };
  }

  return { ok: true };
}

export const sessionCodec = {
  deserialize(raw: unknown): Record<string, unknown> | null {
    if (!isRecord(raw)) return null;

    const remoteSessionId =
      readNonEmptyString(raw.remoteSessionId) ??
      readNonEmptyString(raw.remote_session_id) ??
      readNonEmptyString(raw.sessionId);
    if (!remoteSessionId) return null;

    const parsed = opencodeFullRemoteSessionParamsSchema.safeParse({
      ownership: raw.ownership,
      baseUrl: raw.baseUrl,
      remoteSessionId,
      projectTargetMode: raw.projectTargetMode,
      resolvedTargetIdentity: raw.resolvedTargetIdentity,
      canonicalWorkspaceId: raw.canonicalWorkspaceId ?? null,
      canonicalWorkspaceCwd: raw.canonicalWorkspaceCwd ?? null,
      serverScope: raw.serverScope,
      createdAt: raw.createdAt,
    });

    return parsed.success ? parsed.data : null;
  },
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!params) return null;
    const parsed = opencodeFullRemoteSessionParamsSchema.safeParse(params);
    return parsed.success ? parsed.data : null;
  },
  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (!params) return null;
    return readNonEmptyString(params.remoteSessionId) ?? readNonEmptyString(params.sessionId);
  },
};

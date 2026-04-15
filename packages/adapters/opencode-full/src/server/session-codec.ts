import { createHash } from "node:crypto";
import { z } from "zod";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";
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

function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableNormalize(value)))
    .digest("hex");
}

function sanitizeConfigForFingerprint(config: z.infer<typeof opencodeFullRuntimeConfigSchema>): unknown {
  if (config.executionMode !== "remote_server") {
    return stableNormalize(config);
  }

  const remoteServer = config.remoteServer;
  const auth = (() => {
    switch (remoteServer.auth.mode) {
      case "none":
        return { mode: "none" };
      case "bearer":
        return {
          mode: "bearer",
          tokenDigest: hashValue(remoteServer.auth.token),
        };
      case "basic":
        return {
          mode: "basic",
          username: remoteServer.auth.username,
          passwordDigest: hashValue(remoteServer.auth.password),
        };
      case "header":
        return {
          mode: "header",
          headerName: remoteServer.auth.headerName,
          headerValueDigest: hashValue(remoteServer.auth.headerValue),
        };
    }
  })();

  return stableNormalize({
    ...config,
    remoteServer: {
      ...remoteServer,
      auth,
    },
  });
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
  return hashValue(sanitizeConfigForFingerprint(config));
}

export const opencodeFullSessionOwnershipSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  adapterType: z.literal("opencode_full"),
  configFingerprint: z.string().min(1),
});

export const opencodeFullLocalCliSessionParamsSchema = z.object({
  executionMode: z.literal("local_cli"),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  repoRef: z.string().min(1).optional(),
});

export const opencodeFullRemoteSessionParamsSchema = z.object({
  executionMode: z.literal("remote_server"),
  sessionId: z.string().min(1),
  remoteSessionId: z.string().min(1).optional(),
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  adapterType: z.literal("opencode_full"),
  configFingerprint: z.string().min(1),
  ownership: opencodeFullSessionOwnershipSchema.extend({
    executionMode: z.literal("remote_server"),
  }).optional(),
  baseUrl: z.string().url(),
  projectTargetMode: z.literal("server_default"),
  resolvedTargetIdentity: z.string().min(1),
});

export const opencodeFullSessionParamsSchema = z.discriminatedUnion("executionMode", [
  opencodeFullLocalCliSessionParamsSchema,
  opencodeFullRemoteSessionParamsSchema,
]);

export type OpencodeFullRemoteSessionParams = z.infer<typeof opencodeFullRemoteSessionParamsSchema>;
export type OpencodeFullSessionParams = z.infer<typeof opencodeFullSessionParamsSchema>;
export type OpencodeFullSessionOwnership = z.infer<typeof opencodeFullSessionOwnershipSchema>;

function normalizeResolvedTargetIdentity(value: string): string {
  return value.trim();
}

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
    executionMode: "remote_server",
    sessionId: input.remoteSessionId,
    remoteSessionId: input.remoteSessionId,
    companyId: input.companyId,
    agentId: input.agentId,
    adapterType: "opencode_full",
    configFingerprint: createRemoteSessionOwnership(input).configFingerprint,
    ownership: {
      ...createRemoteSessionOwnership(input),
      executionMode: "remote_server",
    },
    baseUrl: config.remoteServer.baseUrl,
    projectTargetMode: target.targetMode,
    resolvedTargetIdentity: normalizeResolvedTargetIdentity(target.resolvedTargetIdentity),
  };
}

export function canResumeRemoteSession(input: {
  companyId: string;
  agentId: string;
  config: unknown;
  sessionParams: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const config = opencodeFullRuntimeConfigSchema.parse(input.config);
  const session = opencodeFullSessionParamsSchema.safeParse(input.sessionParams);

  if (!session.success || session.data.executionMode !== "remote_server") {
    return { ok: false, reason: "invalid_remote_session_params" };
  }
  if (config.executionMode !== "remote_server") return { ok: false, reason: "execution_mode_mismatch" };

  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") return { ok: false, reason: target.code };

  const expectedFingerprint = getConfigFingerprint(config);
  const checks: Array<[boolean, string]> = [
    [session.data.companyId === input.companyId, "company_id_mismatch"],
    [session.data.agentId === input.agentId, "agent_id_mismatch"],
    [session.data.adapterType === "opencode_full", "adapter_type_mismatch"],
    [session.data.executionMode === "remote_server", "execution_mode_mismatch"],
    [session.data.baseUrl === config.remoteServer.baseUrl, "base_url_mismatch"],
    [session.data.configFingerprint === expectedFingerprint, "config_fingerprint_mismatch"],
    [session.data.projectTargetMode === target.targetMode, "target_mode_mismatch"],
    [session.data.resolvedTargetIdentity === normalizeResolvedTargetIdentity(target.resolvedTargetIdentity), "resolved_target_identity_mismatch"],
  ];

  for (const [ok, reason] of checks) {
    if (!ok) return { ok: false, reason };
  }

  return { ok: true };
}

export function getRemoteSessionResumeDecision(input: {
  companyId: string;
  agentId: string;
  config: unknown;
  sessionParams: unknown;
}): { shouldResume: boolean; reason: string | null } {
  const decision = canResumeRemoteSession(input);
  return decision.ok
    ? { shouldResume: true, reason: null }
    : { shouldResume: false, reason: decision.reason };
}

export function shouldStartFreshRemoteSession(input: {
  companyId: string;
  agentId: string;
  config: unknown;
  sessionParams: unknown;
}): boolean {
  return !getRemoteSessionResumeDecision(input).shouldResume;
}

export const sessionCodec = {
  deserialize(raw: unknown): OpencodeFullSessionParams | null {
    if (!isRecord(raw)) return null;
    const ownership = isRecord(raw.ownership) ? raw.ownership : {};
    const inferredExecutionMode =
      readNonEmptyString(raw.executionMode) ??
      readNonEmptyString(ownership.executionMode) ??
      (readNonEmptyString(raw.remoteSessionId) || readNonEmptyString(raw.remote_session_id)
        ? "remote_server"
        : null);

    const sessionId =
      readNonEmptyString(raw.sessionId) ??
      readNonEmptyString(raw.remoteSessionId) ??
      readNonEmptyString(raw.remote_session_id);
    if (!sessionId) return null;

    const local = opencodeFullLocalCliSessionParamsSchema.safeParse({
      executionMode: inferredExecutionMode,
      sessionId,
      cwd: raw.cwd ?? raw.workdir ?? raw.folder,
      workspaceId: raw.workspaceId,
      repoUrl: raw.repoUrl,
      repoRef: raw.repoRef,
    });
    if (local.success) return local.data;

    const parsed = opencodeFullRemoteSessionParamsSchema.safeParse({
      executionMode: inferredExecutionMode,
      sessionId,
      remoteSessionId: raw.remoteSessionId ?? raw.remote_session_id ?? sessionId,
      companyId: raw.companyId ?? ownership.companyId,
      agentId: raw.agentId ?? ownership.agentId,
      adapterType: raw.adapterType ?? ownership.adapterType,
      configFingerprint: raw.configFingerprint ?? ownership.configFingerprint,
      ownership: Object.keys(ownership).length > 0
        ? {
            companyId: raw.companyId ?? ownership.companyId,
            agentId: raw.agentId ?? ownership.agentId,
            adapterType: raw.adapterType ?? ownership.adapterType,
            executionMode: "remote_server",
            configFingerprint: raw.configFingerprint ?? ownership.configFingerprint,
          }
        : undefined,
      baseUrl: raw.baseUrl,
      projectTargetMode: raw.projectTargetMode,
      resolvedTargetIdentity: typeof raw.resolvedTargetIdentity === "string"
        ? normalizeResolvedTargetIdentity(raw.resolvedTargetIdentity)
        : raw.resolvedTargetIdentity,
    });

    return parsed.success ? parsed.data : null;
  },
  serialize(params: Record<string, unknown> | null): OpencodeFullSessionParams | null {
    if (!params) return null;
    const parsed = opencodeFullSessionParamsSchema.safeParse(params);
    return parsed.success ? parsed.data : null;
  },
  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (!params) return null;
    return readNonEmptyString(params.sessionId);
  },
};

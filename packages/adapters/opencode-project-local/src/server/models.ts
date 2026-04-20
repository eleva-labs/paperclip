import { createHash } from "node:crypto";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asBoolean, asString, ensurePathInEnv, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { prepareProjectAwareOpenCodeRuntimeConfig } from "./runtime-config.js";

const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISCOVERY_TIMEOUT_MS = 20_000;
const VOLATILE_ENV_KEY_PREFIXES = ["PAPERCLIP_", "npm_", "NPM_"] as const;
const VOLATILE_ENV_KEY_EXACT = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID", "HOME"]);

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();

function resolveOpenCodeCommand(input: unknown): string {
  const envOverride =
    typeof process.env.PAPERCLIP_OPENCODE_COMMAND === "string" && process.env.PAPERCLIP_OPENCODE_COMMAND.trim().length > 0
      ? process.env.PAPERCLIP_OPENCODE_COMMAND.trim()
      : "opencode";
  return asString(input, envOverride);
}

function normalizeEnv(input: unknown): Record<string, string> {
  const envInput = typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envInput)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function parseModelsOutput(stdout: string): AdapterModel[] {
  const parsed: AdapterModel[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const firstToken = line.split(/\s+/)[0]?.trim() ?? "";
    if (!firstToken.includes("/")) continue;
    const provider = firstToken.slice(0, firstToken.indexOf("/")).trim();
    const model = firstToken.slice(firstToken.indexOf("/") + 1).trim();
    if (!provider || !model) continue;
    parsed.push({ id: `${provider}/${model}`, label: `${provider}/${model}` });
  }
  return dedupeModels(parsed);
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function isVolatileEnvKey(key: string): boolean {
  if (VOLATILE_ENV_KEY_EXACT.has(key)) return true;
  return VOLATILE_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(command: string, cwd: string, env: Record<string, string>, allowProjectConfig: boolean) {
  const envKey = Object.entries(env)
    .filter(([key]) => !isVolatileEnvKey(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${hashValue(value)}`)
    .join("\n");
  return `${command}\n${cwd}\nallowProjectConfig=${allowProjectConfig}\n${envKey}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

function describeWorkspaceMetadata(input: {
  canonicalWorkspaceId?: string | null;
  canonicalWorkspaceCwd?: string | null;
  executionWorkspaceId?: string | null;
  executionWorkspaceSource?: string | null;
}): string {
  const parts = [
    input.canonicalWorkspaceId ? `canonicalWorkspaceId=${input.canonicalWorkspaceId}` : null,
    input.canonicalWorkspaceCwd ? `canonicalWorkspaceCwd=${input.canonicalWorkspaceCwd}` : null,
    input.executionWorkspaceId ? `executionWorkspaceId=${input.executionWorkspaceId}` : null,
    input.executionWorkspaceSource ? `executionWorkspaceSource=${input.executionWorkspaceSource}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export async function discoverProjectAwareOpenCodeModels(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config?: Record<string, unknown>;
  runtimeMetadata?: {
    canonicalWorkspaceId?: string | null;
    canonicalWorkspaceCwd?: string | null;
    executionWorkspaceId?: string | null;
    executionWorkspaceSource?: string | null;
  };
} = {}): Promise<AdapterModel[]> {
  const command = resolveOpenCodeCommand(input.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const config = input.config ?? {};
  const prepared = await prepareProjectAwareOpenCodeRuntimeConfig({ env, config, cwd });
  try {
    const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...prepared.env }));
    const result = await runChildProcess(
      `opencode-project-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      command,
      ["models"],
      {
        cwd,
        env: runtimeEnv,
        timeoutSec: MODELS_DISCOVERY_TIMEOUT_MS / 1000,
        graceSec: 3,
        onLog: async () => {},
      },
    );

    if (result.timedOut) {
      throw new Error(
        `\`opencode models\` timed out after ${MODELS_DISCOVERY_TIMEOUT_MS / 1000}s${describeWorkspaceMetadata(input.runtimeMetadata ?? {})}.`,
      );
    }
    if ((result.exitCode ?? 1) !== 0) {
      const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
      throw new Error(
        detail
          ? `\`opencode models\` failed: ${detail}${describeWorkspaceMetadata(input.runtimeMetadata ?? {})}`
          : `\`opencode models\` failed${describeWorkspaceMetadata(input.runtimeMetadata ?? {})}.`,
      );
    }

    return sortModels(parseModelsOutput(result.stdout));
  } finally {
    await prepared.cleanup();
  }
}

export async function discoverProjectAwareOpenCodeModelsCached(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config?: Record<string, unknown>;
  runtimeMetadata?: {
    canonicalWorkspaceId?: string | null;
    canonicalWorkspaceCwd?: string | null;
    executionWorkspaceId?: string | null;
    executionWorkspaceSource?: string | null;
  };
} = {}): Promise<AdapterModel[]> {
  const command = resolveOpenCodeCommand(input.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const allowProjectConfig = asBoolean(input.config?.allowProjectConfig, true);
  const key = discoveryCacheKey(command, cwd, env, allowProjectConfig);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await discoverProjectAwareOpenCodeModels({ ...input, command, cwd, env });
  discoveryCache.set(key, { expiresAt: now + MODELS_CACHE_TTL_MS, models });
  return models;
}

export async function ensureProjectAwareOpenCodeModelConfiguredAndAvailable(input: {
  model?: unknown;
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config?: Record<string, unknown>;
  runtimeMetadata?: {
    canonicalWorkspaceId?: string | null;
    canonicalWorkspaceCwd?: string | null;
    executionWorkspaceId?: string | null;
    executionWorkspaceSource?: string | null;
  };
}): Promise<AdapterModel[]> {
  const model = asString(input.model, "").trim();
  if (!model) {
    throw new Error("OpenCode requires `adapterConfig.model` in provider/model format.");
  }

  const models = await discoverProjectAwareOpenCodeModelsCached(input);
  if (models.length === 0) {
    throw new Error(
      `OpenCode returned no models. Run \`opencode models\` and verify provider auth${describeWorkspaceMetadata(input.runtimeMetadata ?? {})}.`,
    );
  }
  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(
      `Configured OpenCode model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}${describeWorkspaceMetadata(input.runtimeMetadata ?? {})}`,
    );
  }

  return models;
}

export async function listProjectAwareOpenCodeModels(): Promise<AdapterModel[]> {
  try {
    return await discoverProjectAwareOpenCodeModelsCached();
  } catch {
    return [];
  }
}

export function resetProjectAwareOpenCodeModelsCacheForTests() {
  discoveryCache.clear();
}

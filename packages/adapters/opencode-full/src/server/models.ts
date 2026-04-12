import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asBoolean, asString, ensurePathInEnv, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullLocalCliRuntimeConfig, OpencodeFullRemoteServerRuntimeConfig } from "./config-schema.js";
import { buildRemoteAuthHeaders, validateResolvedRemoteAuth } from "./remote-auth.js";

const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISCOVERY_TIMEOUT_MS = 20_000;
const VOLATILE_ENV_KEY_PREFIXES = ["PAPERCLIP_", "npm_", "NPM_"] as const;
const VOLATILE_ENV_KEY_EXACT = new Set(["PWD", "OLDPWD", "SHLVL", "_", "TERM_SESSION_ID", "HOME"]);

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();

type PreparedLocalCliRuntimeConfig = {
  env: Record<string, string>;
  notes: string[];
  cleanup: () => Promise<void>;
};

function resolveXdgConfigHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
    (typeof process.env.XDG_CONFIG_HOME === "string" && process.env.XDG_CONFIG_HOME.trim()) ||
    path.join(os.homedir(), ".config")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filepath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
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
  return [...models].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
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
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
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

export async function prepareLocalCliRuntimeConfig(input: {
  env: Record<string, string>;
  config: OpencodeFullLocalCliRuntimeConfig;
  cwd: string;
}): Promise<PreparedLocalCliRuntimeConfig> {
  const allowProjectConfig = asBoolean(input.config.localCli.allowProjectConfig, true);
  const skipPermissions = asBoolean(input.config.localCli.dangerouslySkipPermissions, false);
  const notes: string[] = [];
  const nextEnv: Record<string, string> = { ...input.env };

  if (!allowProjectConfig) {
    if (!("OPENCODE_DISABLE_PROJECT_CONFIG" in nextEnv)) {
      nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
      notes.push("Disabled repo-local OpenCode project config because localCli.allowProjectConfig=false.");
    } else {
      notes.push(
        `Preserved explicit OPENCODE_DISABLE_PROJECT_CONFIG=${JSON.stringify(nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG)} override.`,
      );
    }
  } else if ("OPENCODE_DISABLE_PROJECT_CONFIG" in nextEnv) {
    notes.push(
      `Preserved explicit OPENCODE_DISABLE_PROJECT_CONFIG=${JSON.stringify(nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG)} override while localCli.allowProjectConfig=true.`,
    );
  } else {
    notes.push(`Repo-local OpenCode project config remains enabled for cwd ${input.cwd}.`);
  }

  if (!skipPermissions) {
    return {
      env: nextEnv,
      notes,
      cleanup: async () => {},
    };
  }

  const sourceConfigDir = path.join(resolveXdgConfigHome(nextEnv), "opencode");
  const runtimeConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-full-config-"));
  const runtimeConfigDir = path.join(runtimeConfigHome, "opencode");
  const runtimeConfigPath = path.join(runtimeConfigDir, "opencode.json");

  await fs.mkdir(runtimeConfigDir, { recursive: true });
  try {
    await fs.cp(sourceConfigDir, runtimeConfigDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
      dereference: false,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
  }

  const existingConfig = await readJsonObject(runtimeConfigPath);
  const existingPermission = isPlainObject(existingConfig.permission) ? existingConfig.permission : {};
  const nextConfig = {
    ...existingConfig,
    permission: {
      ...existingPermission,
      external_directory: "allow",
    },
  };
  await fs.writeFile(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    env: {
      ...nextEnv,
      XDG_CONFIG_HOME: runtimeConfigHome,
    },
    notes: [
      ...notes,
      "Injected runtime OpenCode config with permission.external_directory=allow to avoid headless approval prompts.",
    ],
    cleanup: async () => {
      await fs.rm(runtimeConfigHome, { recursive: true, force: true });
    },
  };
}

export async function discoverLocalCliOpenCodeModels(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config: OpencodeFullLocalCliRuntimeConfig;
}): Promise<AdapterModel[]> {
  const command = asString(input.command, input.config.localCli.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const prepared = await prepareLocalCliRuntimeConfig({ env, config: input.config, cwd });

  try {
    const runtimeEnv = normalizeEnv(ensurePathInEnv({ ...process.env, ...prepared.env }));
    const result = await runChildProcess(
      `opencode-full-models-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
      throw new Error(`\`opencode models\` timed out after ${MODELS_DISCOVERY_TIMEOUT_MS / 1000}s.`);
    }
    if ((result.exitCode ?? 1) !== 0) {
      const detail = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
      throw new Error(detail ? `\`opencode models\` failed: ${detail}` : "`opencode models` failed.");
    }

    return sortModels(parseModelsOutput(result.stdout));
  } finally {
    await prepared.cleanup();
  }
}

export async function discoverLocalCliOpenCodeModelsCached(input: {
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config: OpencodeFullLocalCliRuntimeConfig;
}): Promise<AdapterModel[]> {
  const command = asString(input.command, input.config.localCli.command);
  const cwd = asString(input.cwd, process.cwd());
  const env = normalizeEnv(input.env);
  const allowProjectConfig = asBoolean(input.config.localCli.allowProjectConfig, true);
  const key = discoveryCacheKey(command, cwd, env, allowProjectConfig);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await discoverLocalCliOpenCodeModels({ ...input, command, cwd, env });
  discoveryCache.set(key, { expiresAt: now + MODELS_CACHE_TTL_MS, models });
  return models;
}

export async function ensureLocalCliOpenCodeModelConfiguredAndAvailable(input: {
  model?: unknown;
  command?: unknown;
  cwd?: unknown;
  env?: unknown;
  config: OpencodeFullLocalCliRuntimeConfig;
}): Promise<AdapterModel[]> {
  const model = asString(input.model, "").trim();
  if (!model) {
    throw new Error("OpenCode requires `adapterConfig.model` in provider/model format.");
  }

  const models = await discoverLocalCliOpenCodeModelsCached(input);
  if (models.length === 0) {
    throw new Error("OpenCode returned no models. Run `opencode models` and verify provider auth.");
  }
  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(
      `Configured OpenCode model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}`,
    );
  }

  return models;
}

export async function listLocalCliOpenCodeModels(config?: OpencodeFullLocalCliRuntimeConfig): Promise<AdapterModel[]> {
  if (!config) return [];
  try {
    return await discoverLocalCliOpenCodeModelsCached({ config });
  } catch {
    return [];
  }
}

export function resetLocalCliOpenCodeModelsCacheForTests() {
  discoveryCache.clear();
}

const REMOTE_FETCH_DEFAULT_TIMEOUT_MS = 10_000;

type RemoteServerHealthResult = {
  ok: boolean;
  failureKind?: "unreachable" | "auth_unresolved" | "auth_rejected" | "unhealthy";
  status: number;
  message: string;
  detail?: string;
};

function joinUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const pathValue = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${pathValue}`;
}

function firstResponseTextLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function normalizeRemoteFetchError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchRemoteJson(input: {
  baseUrl: string;
  path: string;
  auth: unknown;
  timeoutSec: number;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; text: string; data: unknown }> {
  const authCheck = validateResolvedRemoteAuth(input.auth);
  if (!authCheck.ok) {
    throw new Error(authCheck.reason);
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, input.timeoutSec) * 1000 || REMOTE_FETCH_DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(joinUrl(input.baseUrl, input.path), {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...((input.method ?? "GET") === "POST" ? { "Content-Type": "application/json" } : {}),
        ...buildRemoteAuthHeaders(authCheck.auth),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, text, data };
  } finally {
    clearTimeout(timer);
  }
}

function parseRemoteModelsPayload(payload: unknown): AdapterModel[] {
  const source =
    Array.isArray(payload) ? payload
    : isPlainObject(payload) && Array.isArray(payload.models) ? payload.models
    : [];

  const parsed: AdapterModel[] = [];
  for (const entry of source) {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (id) parsed.push({ id, label: id });
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const id = asString(entry.id, "").trim() || asString(entry.name, "").trim() || asString(entry.model, "").trim();
    if (!id) continue;
    const label = asString(entry.label, "").trim() || id;
    parsed.push({ id, label });
  }

  return sortModels(dedupeModels(parsed));
}

export async function checkRemoteServerHealth(config: OpencodeFullRemoteServerRuntimeConfig): Promise<RemoteServerHealthResult> {
  const authCheck = validateResolvedRemoteAuth(config.remoteServer.auth);
  if (!authCheck.ok) {
    return {
      ok: false,
      failureKind: "auth_unresolved",
      status: 0,
      message: authCheck.reason,
    };
  }

  try {
    const response = await fetchRemoteJson({
      baseUrl: config.remoteServer.baseUrl,
      path: "/health",
      auth: authCheck.auth,
      timeoutSec: config.remoteServer.healthTimeoutSec,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        failureKind: "auth_rejected",
        status: response.status,
        message: `Remote server rejected authentication (${response.status}).`,
        detail: firstResponseTextLine(response.text),
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        failureKind: "unhealthy",
        status: response.status,
        message: `Remote server health check failed (${response.status}).`,
        detail: firstResponseTextLine(response.text),
      };
    }

    return {
      ok: true,
      status: response.status,
      message: "Remote server health check succeeded.",
      detail: isPlainObject(response.data) ? asString(response.data.status, "").trim() || undefined : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      failureKind: "unreachable",
      status: 0,
      message: `Remote server health check could not reach ${config.remoteServer.baseUrl}.`,
      detail: normalizeRemoteFetchError(err),
    };
  }
}

export async function discoverRemoteServerOpenCodeModels(config: OpencodeFullRemoteServerRuntimeConfig): Promise<AdapterModel[]> {
  const response = await fetchRemoteJson({
    baseUrl: config.remoteServer.baseUrl,
    path: "/models",
    auth: config.remoteServer.auth,
    timeoutSec: config.connectTimeoutSec,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Remote server rejected authentication (${response.status}) during model discovery.`);
  }
  if (!response.ok) {
    const detail = firstResponseTextLine(response.text);
    throw new Error(detail ? `Remote model discovery failed (${response.status}): ${detail}` : `Remote model discovery failed (${response.status}).`);
  }

  return parseRemoteModelsPayload(response.data);
}

export async function ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config: OpencodeFullRemoteServerRuntimeConfig): Promise<AdapterModel[]> {
  const model = config.model.trim();
  if (!model) {
    throw new Error("OpenCode remote_server requires `adapterConfig.model` in provider/model format.");
  }

  const models = await discoverRemoteServerOpenCodeModels(config);
  if (models.length === 0) {
    throw new Error("Remote server returned no models.");
  }
  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(
      `Configured remote OpenCode model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}`,
    );
  }

  return models;
}

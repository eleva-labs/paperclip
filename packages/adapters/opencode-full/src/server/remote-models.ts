import type { AdapterModel } from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";
import { getRemoteHealth, getRemoteProvider, getRemoteProviders, readRemoteError } from "./remote-client.js";
import { validateResolvedRemoteAuth } from "./remote-auth.js";

type RemoteServerHealthResult = {
  ok: boolean;
  failureKind?: "unreachable" | "auth_unresolved" | "auth_rejected" | "unhealthy";
  status: number;
  message: string;
  detail?: string;
};

function dedupe(models: AdapterModel[]) {
  const seen = new Set<string>();
  return models
    .filter((model) => {
      const id = model.id.trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }));
}

function listProviderModelIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const text = typeof entry === "string"
        ? entry.trim()
        : asString(parseObject(entry).id, "").trim()
          || asString(parseObject(entry).modelID, "").trim()
          || asString(parseObject(entry).name, "").trim();
      return text ? [text] : [];
    });
  }

  const record = parseObject(value);
  const keys = Object.keys(record);
  if (keys.length === 0) return [];

  return keys.flatMap((key) => {
    const model = parseObject(record[key]);
    const text = asString(model.id, "").trim()
      || asString(model.modelID, "").trim()
      || asString(model.name, "").trim()
      || key.trim();
    return text ? [text] : [];
  });
}

function fromProviders(payload: unknown): AdapterModel[] {
  const data = parseObject(payload);
  const defaults = parseObject(data.default);
  const providers = Array.isArray(data.providers) ? data.providers : [];

  return dedupe(providers.flatMap((value) => {
    const provider = parseObject(value);
    const id = asString(provider.id, "").trim() || asString(provider.providerID, "").trim() || asString(provider.name, "").trim();
    if (!id) return [];

    const listed = listProviderModelIds(provider.models).map((modelId) => (
      { id: `${id}/${modelId}`, label: `${id}/${modelId}` } satisfies AdapterModel
    ));

    const fallback = asString(defaults[id], "").trim();
    if (listed.length > 0) return listed;
    if (!fallback) return [];
    return [{ id: `${id}/${fallback}`, label: `${id}/${fallback}` } satisfies AdapterModel];
  }));
}

function fromProviderInventory(payload: unknown): AdapterModel[] {
  const data = parseObject(payload);
  const all = Array.isArray(data.all) ? data.all : [];
  return dedupe(all.flatMap((value) => {
    const provider = parseObject(value);
    const id = asString(provider.id, "").trim() || asString(provider.providerID, "").trim() || asString(provider.name, "").trim();
    const model = asString(provider.defaultModel, "").trim() || asString(provider.modelID, "").trim();
    if (!id || !model) return [];
    return [{ id: `${id}/${model}`, label: `${id}/${model}` } satisfies AdapterModel];
  }));
}

export async function discoverRemoteServerOpenCodeModels(config: OpencodeFullRemoteServerRuntimeConfig): Promise<AdapterModel[]> {
  const providers = await getRemoteProviders(config);
  if (providers.status === 401 || providers.status === 403) {
    throw new Error(`Remote server rejected authentication (${providers.status}) during model discovery.`);
  }
  if (!providers.ok) {
    throw new Error(readRemoteError(providers.data, providers.text, `Remote model discovery failed (${providers.status}).`));
  }

  const primary = fromProviders(providers.data);
  if (primary.length > 0) return primary;

  const inventory = await getRemoteProvider(config);
  if (inventory.ok) {
    const fallback = fromProviderInventory(inventory.data);
    if (fallback.length > 0) return fallback;
  }

  return [];
}

export async function checkRemoteServerHealth(config: OpencodeFullRemoteServerRuntimeConfig): Promise<RemoteServerHealthResult> {
  const auth = validateResolvedRemoteAuth(config.remoteServer.auth);
  if (!auth.ok) {
    return {
      ok: false,
      failureKind: "auth_unresolved",
      status: 0,
      message: auth.reason,
    };
  }

  try {
    const response = await getRemoteHealth(config);
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        failureKind: "auth_rejected",
        status: response.status,
        message: `Remote server rejected authentication (${response.status}).`,
        detail: response.text,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        failureKind: "unhealthy",
        status: response.status,
        message: `Remote server health check failed (${response.status}).`,
        detail: response.text,
      };
    }

    return {
      ok: true,
      status: response.status,
      message: "Remote server health check succeeded.",
      detail: asString(parseObject(response.data).version, "").trim() || undefined,
    };
  } catch (err) {
    return {
      ok: false,
      failureKind: "unreachable",
      status: 0,
      message: `Remote server health check could not reach ${config.remoteServer.baseUrl}.`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function remoteServerExecutionScope(config: OpencodeFullRemoteServerRuntimeConfig): "server_default_only" | "deferred_target_mode" {
  return config.remoteServer.projectTarget.mode === "server_default" ? "server_default_only" : "deferred_target_mode";
}

export async function ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config: OpencodeFullRemoteServerRuntimeConfig): Promise<AdapterModel[]> {
  const model = config.model.trim();
  if (!model) {
    throw new Error("OpenCode remote_server requires `adapterConfig.model` in provider/model format.");
  }

  const models = await discoverRemoteServerOpenCodeModels(config);
  if (models.length === 0) {
    throw new Error("Remote server returned no configured provider/model entries.");
  }
  if (!models.some((entry) => entry.id === model)) {
    const sample = models.slice(0, 12).map((entry) => entry.id).join(", ");
    throw new Error(`Configured remote OpenCode model is unavailable: ${model}. Available models: ${sample}${models.length > 12 ? ", ..." : ""}`);
  }

  return models;
}

import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullRemoteAuthRuntime, OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";
import { buildRemoteAuthHeaders } from "./remote-auth.js";
import { validateRemoteServerBaseUrl } from "./remote-base-url.js";

export type RemoteJsonResponse = {
  ok: boolean;
  status: number;
  text: string;
  data: unknown;
};

function join(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const base = url.pathname.replace(/\/+$/, "");
  const next = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.pathname = `${base}${next}`.replace(/\/+/g, "/");
  return url.toString();
}

async function requestJson(input: {
  baseUrl: string;
  auth: OpencodeFullRemoteAuthRuntime;
  method?: "GET" | "POST";
  path: string;
  timeoutSec: number;
  body?: Record<string, unknown>;
  directory?: string | null;
}): Promise<RemoteJsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, input.timeoutSec) * 1000);

  try {
    const url = new URL(join(input.baseUrl, input.path));
    if (input.directory) {
      url.searchParams.set("directory", input.directory);
    }
    const response = await fetch(url.toString(), {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...buildRemoteAuthHeaders(input.auth),
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

export function readResponseLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

export function readSessionId(payload: unknown): string | null {
  const data = parseObject(payload);
  return asString(data.id, "").trim() || asString(data.sessionID, "").trim() || asString(data.sessionId, "").trim() || null;
}

export function readRemoteError(payload: unknown, text: string, fallback: string): string {
  const data = parseObject(payload);
  return (
    asString(data.errorMessage, "").trim() ||
    asString(parseObject(data.error).message, "").trim() ||
    asString(data.message, "").trim() ||
    readResponseLine(text) ||
    fallback
  );
}

export function readUsage(payload: unknown): { inputTokens: number; cachedInputTokens: number; outputTokens: number } {
  const data = parseObject(payload);
  const usage = parseObject(data.usage);
  const tokens = parseObject(data.tokens);
  const cache = parseObject(usage.cache);
  return {
    inputTokens: asNumber(usage.inputTokens, asNumber(usage.input, asNumber(tokens.input, 0))),
    cachedInputTokens: asNumber(usage.cachedInputTokens, asNumber(cache.read, 0)),
    outputTokens: asNumber(usage.outputTokens, asNumber(usage.output, asNumber(tokens.output, 0)) + asNumber(tokens.reasoning, 0)),
  };
}

export async function getRemoteHealth(config: OpencodeFullRemoteServerRuntimeConfig) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: "/global/health",
    timeoutSec: config.remoteServer.healthTimeoutSec,
  });
}

export async function getRemoteProviders(config: OpencodeFullRemoteServerRuntimeConfig) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: "/config/providers",
    timeoutSec: config.connectTimeoutSec,
  });
}

export async function getRemoteProvider(config: OpencodeFullRemoteServerRuntimeConfig) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: "/provider",
    timeoutSec: config.connectTimeoutSec,
  });
}

export async function createRemoteSession(config: OpencodeFullRemoteServerRuntimeConfig, body: Record<string, unknown> = {}) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    method: "POST",
    path: "/session",
    timeoutSec: config.connectTimeoutSec,
    body,
    directory: config.remoteServer.projectTarget.mode === "linked_project_context"
      ? (config.remoteServer.linkRef?.linkedDirectoryHint ?? null)
      : null,
  });
}

export async function getRemoteSession(config: OpencodeFullRemoteServerRuntimeConfig, sessionId: string) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: `/session/${encodeURIComponent(sessionId)}`,
    timeoutSec: config.connectTimeoutSec,
    directory: config.remoteServer.projectTarget.mode === "linked_project_context"
      ? (config.remoteServer.linkRef?.linkedDirectoryHint ?? null)
      : null,
  });
}

export async function getRemoteSessionMessages(config: OpencodeFullRemoteServerRuntimeConfig, sessionId: string) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: `/session/${encodeURIComponent(sessionId)}/message`,
    timeoutSec: config.connectTimeoutSec,
    directory: config.remoteServer.projectTarget.mode === "linked_project_context"
      ? (config.remoteServer.linkRef?.linkedDirectoryHint ?? null)
      : null,
  });
}

export async function getRemoteSessionStatus(config: OpencodeFullRemoteServerRuntimeConfig) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    path: "/session/status",
    timeoutSec: config.connectTimeoutSec,
  });
}

export async function postRemoteSessionMessage(
  config: OpencodeFullRemoteServerRuntimeConfig,
  sessionId: string,
  body: Record<string, unknown>,
) {
  return requestJson({
    baseUrl: config.remoteServer.baseUrl,
    auth: config.remoteServer.auth,
    method: "POST",
    path: `/session/${encodeURIComponent(sessionId)}/message`,
    timeoutSec: config.timeoutSec,
    body,
    directory: config.remoteServer.projectTarget.mode === "linked_project_context"
      ? (config.remoteServer.linkRef?.linkedDirectoryHint ?? null)
      : null,
  });
}

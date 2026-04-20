import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullRemoteAuthRuntime, OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";
import { buildRemoteAuthHeaders } from "./remote-auth.js";
import { validateRemoteServerBaseUrl } from "./remote-base-url.js";
import {
  opencodeRemoteGlobalEventEnvelopeSchema,
  type OpencodeRemoteGlobalEventEnvelope,
} from "./remote-stream-schema.js";

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

// ---------------------------------------------------------------------------
// /global/event SSE subscription (design §4.1)
// ---------------------------------------------------------------------------

export type RemoteGlobalEventSubscription = {
  /**
   * Resolves after the first `server.connected` frame; rejects on hard
   * pre-handshake failures (malformed framing/JSON or aborted transport).
   */
  connected: Promise<void>;
  /**
   * Resolves when the SSE pump exits for any reason (clean server close,
   * transport error, or explicit close/abort). Downstream code can race
   * this against the prompt POST to detect mid-run stream disconnects.
   */
  done: Promise<void>;
  /**
   * Explicit close/abort entry point that downstream execution can call to
   * tear the SSE reader down without leaking it. Idempotent.
   */
  close: () => Promise<void>;
  /**
   * Post-handshake diagnostic counter for dropped frames/events (malformed
   * framing, malformed JSON, or envelope validation failures observed after
   * `server.connected`). Pre-handshake defects never increment this counter —
   * they are promoted to hard subscribe failures instead.
   */
  droppedEvents: () => number;
};

export type SubscribeRemoteGlobalEventsInput = {
  config: OpencodeFullRemoteServerRuntimeConfig;
  signal?: AbortSignal;
  onEnvelope: (envelope: OpencodeRemoteGlobalEventEnvelope) => void | Promise<void>;
  // Test/DI seam: defaults to `globalThis.fetch`. Not exported for production
  // callers, but allows deterministic SSE framing tests without leaking
  // network I/O into unit tests.
  fetchImpl?: typeof fetch;
};

type SseFrame = {
  event: string | null;
  data: string;
};

// Parse an SSE block (already split on blank-line boundary) into a single
// frame. Returns null if the block contained only comments/heartbeats.
function parseSseBlock(block: string): SseFrame | null {
  const lines = block.split(/\r?\n/);
  let event: string | null = null;
  const dataLines: string[] = [];
  let sawData = false;
  for (const raw of lines) {
    if (raw.length === 0) continue;
    if (raw.startsWith(":")) {
      // Comment/heartbeat line — ignored silently by SSE spec.
      continue;
    }
    const colonAt = raw.indexOf(":");
    const field = colonAt === -1 ? raw : raw.slice(0, colonAt);
    // SSE permits "field: value" where a single space after the colon is
    // stripped. Per spec, missing colon => whole line is field name with
    // empty value.
    const rawValue = colonAt === -1 ? "" : raw.slice(colonAt + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "data") {
      dataLines.push(value);
      sawData = true;
    } else if (field === "event") {
      event = value;
    }
    // Other SSE fields (id, retry) are not meaningful for /global/event.
  }
  if (!sawData) return null;
  return { event, data: dataLines.join("\n") };
}

function isServerConnectedPayload(envelope: OpencodeRemoteGlobalEventEnvelope): boolean {
  return envelope.payload.type === "server.connected";
}

function buildGlobalEventUrl(baseUrl: string): string {
  return join(baseUrl, "/global/event");
}

// eslint-disable-next-line complexity
export async function subscribeRemoteGlobalEvents(
  input: SubscribeRemoteGlobalEventsInput,
): Promise<RemoteGlobalEventSubscription> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.config.remoteServer.baseUrl;
  const baseUrlValidation = validateRemoteServerBaseUrl(baseUrl);
  if (!baseUrlValidation.ok) {
    throw new Error(`Remote /global/event subscribe rejected: ${baseUrlValidation.message}`);
  }

  // Internal abort controller linked to the caller's signal. Either the
  // caller or `close()` can abort the stream, and both paths unwind the
  // reader loop without leaking.
  const controller = new AbortController();
  const externalSignal = input.signal;
  let externalAbortHandler: (() => void) | null = null;

  let response: Response;
  try {
    response = await fetchImpl(buildGlobalEventUrl(baseUrl), {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...buildRemoteAuthHeaders(input.config.remoteServer.auth),
      },
      signal: controller.signal,
    });
  } catch (err) {
    // Transport-level failure before SSE could even be established. This is
    // a hard subscribe error per design §4.1 / §6.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Remote /global/event subscribe failed: ${detail}`);
  }

  if (!response.ok) {
    // Non-200 is a hard pre-submit failure per design §4.1.
    try {
      // Drain the body so the connection can be reclaimed. We don't need
      // the text, and we ignore read errors here.
      await response.text().catch(() => undefined);
    } finally {
      controller.abort();
    }
    throw new Error(
      `Remote /global/event subscribe returned non-2xx status ${response.status}.`,
    );
  }

  if (!response.body) {
    controller.abort();
    throw new Error("Remote /global/event subscribe response has no body stream.");
  }

  let handshakeResolve: (() => void) | null = null;
  let handshakeReject: ((err: Error) => void) | null = null;
  const connected = new Promise<void>((resolve, reject) => {
    handshakeResolve = resolve;
    handshakeReject = reject;
  });

  let handshakeSettled = false;
  let droppedEvents = 0;
  let closed = false;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const closeReader = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Detach the external signal listener so we don't hold a reference to the
    // caller's AbortController after the stream is torn down.
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener("abort", externalAbortHandler);
      externalAbortHandler = null;
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // Cancel may reject if the stream is already finished; that's fine.
    }
  };

  const failHandshake = async (err: Error): Promise<void> => {
    if (handshakeSettled) return;
    handshakeSettled = true;
    if (handshakeReject) handshakeReject(err);
    await closeReader();
  };

  const succeedHandshake = (): void => {
    if (handshakeSettled) return;
    handshakeSettled = true;
    if (handshakeResolve) handshakeResolve();
  };

  const handleBlock = async (block: string): Promise<void> => {
    let frame: SseFrame | null;
    try {
      frame = parseSseBlock(block);
    } catch (err) {
      // Defensive — parseSseBlock does not throw today, but if framing parse
      // fails before handshake we must hard-fail; after handshake we drop.
      if (!handshakeSettled) {
        await failHandshake(
          err instanceof Error
            ? new Error(`Malformed SSE frame before handshake: ${err.message}`)
            : new Error("Malformed SSE frame before handshake."),
        );
        return;
      }
      droppedEvents += 1;
      return;
    }
    if (frame === null) {
      // Pure heartbeat/comment block — ignore silently, do not count.
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(frame.data);
    } catch (err) {
      if (!handshakeSettled) {
        await failHandshake(
          new Error(
            `Malformed JSON in /global/event data frame before handshake: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
        return;
      }
      droppedEvents += 1;
      return;
    }

    const envelopeResult = opencodeRemoteGlobalEventEnvelopeSchema.safeParse(parsedJson);
    if (!envelopeResult.success) {
      if (!handshakeSettled) {
        await failHandshake(
          new Error(
            `Invalid /global/event envelope before handshake: ${envelopeResult.error.message}`,
          ),
        );
        return;
      }
      droppedEvents += 1;
      return;
    }

    const envelope = envelopeResult.data;

    if (!handshakeSettled) {
      if (isServerConnectedPayload(envelope)) {
        succeedHandshake();
        try {
          await input.onEnvelope(envelope);
        } catch {
          // Consumer errors after handshake are not hard transport failures.
        }
        return;
      }
      // Pre-handshake non-connected envelopes are ignored; we only treat
      // malformed framing/JSON/envelope as hard pre-handshake failures.
      return;
    }

    try {
      await input.onEnvelope(envelope);
    } catch {
      // Consumer errors must not tear the stream down; downstream correlation
      // has its own diagnostic surface for unmappable events.
    }
  };

  // Wire the caller's signal to our internal teardown so that an external
  // abort unwinds the reader loop. This must happen after closeReader /
  // failHandshake are defined because the handler invokes them.
  if (externalSignal) {
    if (externalSignal.aborted) {
      // Already aborted before we got here — tear down immediately.
      void failHandshake(new Error("Remote /global/event subscribe aborted."));
    } else {
      externalAbortHandler = () => {
        if (!handshakeSettled) {
          void failHandshake(new Error("Remote /global/event subscribe aborted."));
        } else {
          void closeReader();
        }
      };
      externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
    }
  }

  const pump = async (): Promise<void> => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by blank lines (CRLF or LF). Split on a
        // blank-line boundary and keep the trailing partial block in the
        // buffer until more bytes arrive.
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          // Advance past the boundary marker (either "\n\n" or "\r\n\r\n").
          const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
          const advance = match ? match[0].length : 2;
          buffer = buffer.slice(boundary + advance);
          await handleBlock(block);
          if (closed) return;
          boundary = buffer.search(/\r?\n\r?\n/);
        }
      }
      // Flush trailing partial block if the server closed cleanly mid-frame.
      if (buffer.trim().length > 0) {
        const remaining = buffer;
        buffer = "";
        await handleBlock(remaining);
      }
    } catch (err) {
      if (!handshakeSettled) {
        await failHandshake(
          err instanceof Error
            ? new Error(`/global/event transport failed before handshake: ${err.message}`)
            : new Error("/global/event transport failed before handshake."),
        );
        return;
      }
      // Post-handshake transport errors close the stream; downstream run
      // orchestration converts that into a degraded-stream signal.
      await closeReader();
      return;
    }
    // Reader closed from server side without an explicit `server.connected`.
    if (!handshakeSettled) {
      await failHandshake(
        new Error("/global/event stream closed before server.connected handshake."),
      );
    }
  };

  // Kick off the pump but do not await it; its lifetime is tied to the
  // subscription, not to the returned Promise. Unhandled errors inside
  // `pump` are already surfaced via `connected` or silently end the stream.
  // The `done` promise resolves when the pump exits for any reason.
  const done = pump();

  return {
    connected,
    done,
    close: closeReader,
    droppedEvents: () => droppedEvents,
  };
}

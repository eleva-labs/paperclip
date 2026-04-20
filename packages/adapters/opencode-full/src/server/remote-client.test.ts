import { afterEach, describe, expect, it, vi } from "vitest";

import { subscribeRemoteGlobalEvents } from "./remote-client.js";
import type { OpencodeRemoteGlobalEventEnvelope } from "./remote-stream-schema.js";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";

const baseConfig: OpencodeFullRemoteServerRuntimeConfig = {
  executionMode: "remote_server",
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "none" },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" },
  },
};

/**
 * Controllable SSE body. Tests push raw bytes into `.push(...)` and call
 * `.end()` when they want the reader to observe a clean close, or
 * `.error(e)` to surface a transport error.
 */
function makeSseBody() {
  const encoder = new TextEncoder();
  let push: (chunk: string) => void = () => {};
  let close: () => void = () => {};
  let error: (err: unknown) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* stream already closed/cancelled */ }
      };
      close = () => {
        try { controller.close(); } catch { /* stream already closed/cancelled */ }
      };
      error = (err: unknown) => {
        try { controller.error(err); } catch { /* stream already closed/cancelled */ }
      };
    },
  });
  return { stream, push, close, error };
}

function makeFetchMock(options: {
  status?: number;
  body?: ReadableStream<Uint8Array> | null;
  throwError?: unknown;
}): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (options.throwError) throw options.throwError;
    // Hook the signal so the test can verify abort cleanup if desired.
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return new Response(options.body ?? null, {
      status: options.status ?? 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscribeRemoteGlobalEvents", () => {
  it("resolves connected only after the first server.connected frame", async () => {
    const body = makeSseBody();
    const envelopes: OpencodeRemoteGlobalEventEnvelope[] = [];

    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: (e) => {
        envelopes.push(e);
      },
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    let resolved = false;
    subscription.connected.then(() => {
      resolved = true;
    });

    // Push a non-connected session-scoped payload first. This must NOT
    // resolve the handshake, because design §4.1 requires `server.connected`
    // to precede prompt submission.
    body.push(
      frame({
        directory: "/linked/dir",
        payload: {
          type: "session.status",
          properties: { sessionID: "ses-1", status: "running" },
        },
      }),
    );
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);

    body.push(
      frame({
        directory: "/linked/dir",
        payload: { type: "server.connected" },
      }),
    );
    await subscription.connected;
    expect(resolved).toBe(true);

    // The connected envelope is forwarded to the consumer.
    expect(envelopes.at(-1)?.payload.type).toBe("server.connected");

    await subscription.close();
    body.close();
  });

  it("ignores heartbeat/comment frames silently without bumping droppedEvents", async () => {
    const body = makeSseBody();
    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: () => {},
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    // Comment-only block (SSE heartbeat style).
    body.push(":keep-alive\n\n");
    // Another heartbeat with just a colon.
    body.push(":\n\n");

    body.push(
      frame({
        directory: "/linked/dir",
        payload: { type: "server.connected" },
      }),
    );

    await subscription.connected;
    expect(subscription.droppedEvents()).toBe(0);

    await subscription.close();
    body.close();
  });

  it("treats malformed JSON before handshake as a hard subscribe failure", async () => {
    const body = makeSseBody();
    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: () => {},
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    body.push("data: {not-json\n\n");

    await expect(subscription.connected).rejects.toThrow(/before handshake/i);
    // Pre-handshake defects are promoted to hard failures and must NOT
    // increment the post-handshake diagnostic counter.
    expect(subscription.droppedEvents()).toBe(0);
    // Close is idempotent and safe to call even though the pump already
    // unwound the reader as part of the hard failure.
    await subscription.close();
    body.close();
  });

  it("treats malformed envelope JSON before handshake as a hard subscribe failure", async () => {
    const body = makeSseBody();
    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: () => {},
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    // Well-formed JSON but the envelope is missing `directory`/`payload`.
    body.push(`data: ${JSON.stringify({ unexpected: true })}\n\n`);

    await expect(subscription.connected).rejects.toThrow(/before handshake/i);
    expect(subscription.droppedEvents()).toBe(0);
    await subscription.close();
    body.close();
  });

  it("counts malformed frames/JSON after handshake as dropped events and keeps streaming", async () => {
    const body = makeSseBody();
    const envelopes: OpencodeRemoteGlobalEventEnvelope[] = [];
    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: (e) => {
        envelopes.push(e);
      },
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    body.push(
      frame({
        directory: "/linked/dir",
        payload: { type: "server.connected" },
      }),
    );
    await subscription.connected;

    // Post-handshake malformed JSON: counted drop, stream continues.
    body.push("data: {not-json\n\n");
    // Post-handshake invalid envelope shape: counted drop, stream continues.
    body.push(`data: ${JSON.stringify({ wrong: "shape" })}\n\n`);

    // A valid envelope after the malformed frames must still be delivered.
    body.push(
      frame({
        directory: "/linked/dir",
        payload: {
          type: "session.status",
          properties: { sessionID: "ses-1", status: "running" },
        },
      }),
    );

    // Wait for the valid envelope to be delivered.
    for (let i = 0; i < 20 && envelopes.length < 2; i += 1) {
      await new Promise((r) => setImmediate(r));
    }

    expect(subscription.droppedEvents()).toBe(2);
    expect(envelopes.map((e) => e.payload.type)).toEqual([
      "server.connected",
      "session.status",
    ]);

    await subscription.close();
    body.close();
  });

  it("closes cleanly on explicit close() without leaking the reader", async () => {
    const body = makeSseBody();
    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: () => {},
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    body.push(
      frame({
        directory: "/linked/dir",
        payload: { type: "server.connected" },
      }),
    );
    await subscription.connected;

    await subscription.close();
    // Calling close() again must be idempotent.
    await subscription.close();

    // After close, pushing more data must not resurface in any consumer
    // callbacks; the reader is cancelled. We can still call stream.close()
    // defensively to release the producer side.
    body.close();
  });

  it("aborts the transport when the caller's AbortSignal fires", async () => {
    const body = makeSseBody();
    const controller = new AbortController();

    const subscription = await subscribeRemoteGlobalEvents({
      config: baseConfig,
      onEnvelope: () => {},
      signal: controller.signal,
      fetchImpl: makeFetchMock({ body: body.stream }),
    });

    // Abort before handshake: connected must reject, and the reader must
    // have been cancelled so no leak remains.
    controller.abort();

    await expect(subscription.connected).rejects.toThrow();
    await subscription.close();
    body.close();
  });

  it("rejects on non-200 subscribe responses as a hard subscribe failure", async () => {
    await expect(
      subscribeRemoteGlobalEvents({
        config: baseConfig,
        onEnvelope: () => {},
        fetchImpl: makeFetchMock({ status: 503, body: null }),
      }),
    ).rejects.toThrow(/non-2xx status 503/);
  });

  it("rejects when the transport layer throws before a response is returned", async () => {
    await expect(
      subscribeRemoteGlobalEvents({
        config: baseConfig,
        onEnvelope: () => {},
        fetchImpl: makeFetchMock({ throwError: new Error("ECONNREFUSED") }),
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

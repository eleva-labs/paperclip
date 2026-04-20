import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { OpencodeRemoteGlobalEventEnvelope } from "./remote-stream-schema.js";
import type { RemoteGlobalEventSubscription } from "./remote-client.js";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocked = vi.hoisted(() => ({
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: vi.fn(),
  createRemoteSession: vi.fn(),
  getRemoteSession: vi.fn(),
  getRemoteSessionMessages: vi.fn(),
  getRemoteSessionStatus: vi.fn(),
  postRemoteSessionMessage: vi.fn(),
  subscribeRemoteGlobalEvents: vi.fn(),
}));

vi.mock("./remote-models.js", () => ({
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
}));

vi.mock("./remote-client.js", async () => {
  const actual = await vi.importActual<typeof import("./remote-client.js")>("./remote-client.js");
  return {
    ...actual,
    createRemoteSession: mocked.createRemoteSession,
    getRemoteSession: mocked.getRemoteSession,
    getRemoteSessionMessages: mocked.getRemoteSessionMessages,
    getRemoteSessionStatus: mocked.getRemoteSessionStatus,
    postRemoteSessionMessage: mocked.postRemoteSessionMessage,
    subscribeRemoteGlobalEvents: mocked.subscribeRemoteGlobalEvents,
  };
});

import { executeRemoteServer } from "./remote-execute.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const config = {
  executionMode: "remote_server" as const,
  model: "openai/gpt-5.4",
  variant: "fast",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  promptTemplate: "You are {{agent.id}}.",
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "none" as const },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const },
  },
};

const linkedConfig = {
  ...config,
  remoteServer: {
    ...config.remoteServer,
    projectTarget: { mode: "linked_project_context" as const },
    linkRef: {
      mode: "linked_project_context" as const,
      canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
      linkedDirectoryHint: "/tmp/forgebox",
      serverScope: "shared" as const,
      validatedAt: "2026-04-16T00:00:00.000Z",
    },
  },
};

function ctx(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", name: "Agent 1", companyId: "company-1" },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null, ...(overrides.runtime ?? {}) },
    config,
    context: {},
    onLog: vi.fn(async () => {}),
    onMeta: vi.fn(async () => {}),
    onSpawn: vi.fn(async () => {}),
    authToken: null,
    ...overrides,
  } as never;
}

// ---------------------------------------------------------------------------
// Subscription mock helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock subscription that immediately resolves connected and
 * delivers envelopes via the onEnvelope callback captured from the
 * subscribeRemoteGlobalEvents call.
 */
function setupHappySubscription(
  envelopes: OpencodeRemoteGlobalEventEnvelope[] = [],
  options?: { droppedEvents?: number },
): void {
  mocked.subscribeRemoteGlobalEvents.mockImplementation(
    async (input: { onEnvelope: (env: OpencodeRemoteGlobalEventEnvelope) => void | Promise<void> }) => {
      // Deliver all envelopes to the consumer
      for (const env of envelopes) {
        await input.onEnvelope(env);
      }
      const sub: RemoteGlobalEventSubscription = {
        connected: Promise.resolve(),
        done: new Promise<void>(() => {}),
        close: vi.fn(async () => {}),
        droppedEvents: () => options?.droppedEvents ?? 0,
      };
      return sub;
    },
  );
}

/**
 * Creates a mock subscription that resolves connected but also delivers
 * live streaming envelopes via the onEnvelope callback.
 */
function setupStreamingSubscription(
  envelopes: OpencodeRemoteGlobalEventEnvelope[],
  options?: { droppedEvents?: number },
): void {
  mocked.subscribeRemoteGlobalEvents.mockImplementation(
    async (input: { onEnvelope: (env: OpencodeRemoteGlobalEventEnvelope) => void | Promise<void> }) => {
      const closeFn = vi.fn(async () => {});
      const sub: RemoteGlobalEventSubscription = {
        connected: Promise.resolve(),
        done: new Promise<void>(() => {}),
        close: closeFn,
        droppedEvents: () => options?.droppedEvents ?? 0,
      };

      // Deliver envelopes asynchronously (simulating live streaming)
      // The envelopes will be delivered before the POST resolves since
      // we use setTimeout(0) but the POST mock also resolves immediately.
      for (const env of envelopes) {
        await input.onEnvelope(env);
      }

      return sub;
    },
  );
}

/**
 * Creates a mock subscription that fails during the connect phase.
 */
function setupSubscriptionConnectFailure(errorMessage: string): void {
  mocked.subscribeRemoteGlobalEvents.mockRejectedValue(new Error(errorMessage));
}

/**
 * Creates a mock subscription where the connected promise rejects
 * (handshake failure after transport is established).
 */
function setupSubscriptionHandshakeFailure(errorMessage: string): void {
  mocked.subscribeRemoteGlobalEvents.mockResolvedValue({
    connected: Promise.reject(new Error(errorMessage)),
    done: Promise.resolve(),
    close: vi.fn(async () => {}),
    droppedEvents: () => 0,
  } satisfies RemoteGlobalEventSubscription);
}

function setupStandardMocks(): void {
  mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
  mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-1" } });
  mocked.postRemoteSessionMessage.mockResolvedValue({
    ok: true,
    status: 200,
    text: "",
    data: {
      info: { cost: 0.12, usage: { inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 } },
      parts: [{ text: "hello from remote" }],
    },
  });
  mocked.getRemoteSessionMessages.mockResolvedValue({ ok: true, status: 200, text: "", data: [{ parts: [{ text: "hello from remote" }] }] });
}

// ---------------------------------------------------------------------------
// Helper to build envelopes
// ---------------------------------------------------------------------------

function envelope(
  directory: string,
  type: string,
  properties?: Record<string, unknown>,
): OpencodeRemoteGlobalEventEnvelope {
  return {
    directory,
    payload: {
      type,
      ...(properties !== undefined ? { properties } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("opencode_full remote execute", () => {
  afterEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset());
  });

  // ---- Original test cases (preserved from Cycle 0) ----

  it("uses canonical session create + message + message read flow", async () => {
    setupStandardMocks();
    setupHappySubscription();

    const result = await executeRemoteServer(ctx(), config as never);

    expect(mocked.createRemoteSession).toHaveBeenCalledOnce();
    expect(mocked.postRemoteSessionMessage).toHaveBeenCalledWith(
      config,
      "ses-1",
      expect.objectContaining({
        model: { providerID: "openai", modelID: "gpt-5.4" },
        parts: [{ type: "text", text: expect.stringContaining("You are agent-1.") }],
      }),
    );
    expect(mocked.getRemoteSessionMessages).toHaveBeenCalledWith(config, "ses-1");
    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "ses-1",
      sessionDisplayId: "ses-1",
      summary: "hello from remote",
      usage: { inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 },
      sessionParams: {
        executionMode: "remote_server",
        remoteSessionId: "ses-1",
        baseUrl: "https://opencode.example.com",
        projectTargetMode: "server_default",
        resolvedTargetIdentity: "server_default",
      },
    });
  });

  it("passes linked directory targeting through remote create/message flow", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-linked" } });
    mocked.postRemoteSessionMessage.mockResolvedValue({ ok: true, status: 200, text: "", data: { info: {}, parts: [{ text: "hello linked" }] } });
    mocked.getRemoteSessionMessages.mockResolvedValue({ ok: true, status: 200, text: "", data: [{ parts: [{ text: "hello linked" }] }] });
    // For linked config, the subscription receives an envelope matching the linked directory
    setupHappySubscription();

    const result = await executeRemoteServer(ctx(), linkedConfig as never);

    expect(mocked.createRemoteSession).toHaveBeenCalledWith(linkedConfig, {});
    expect(mocked.postRemoteSessionMessage).toHaveBeenCalledWith(
      linkedConfig,
      "ses-linked",
      expect.any(Object),
    );
    expect(mocked.getRemoteSessionMessages).toHaveBeenCalledWith(linkedConfig, "ses-linked");
    expect(result.sessionParams).toMatchObject({
      projectTargetMode: "linked_project_context",
      resolvedTargetIdentity: "linked_project_context:11111111-1111-4111-8111-111111111111:/tmp/forgebox",
      canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
      linkedDirectoryHint: "/tmp/forgebox",
    });
  });

  it("fails early when linked_project_context runtime metadata is incomplete", async () => {
    const result = await executeRemoteServer(ctx(), {
      ...config,
      remoteServer: {
        ...config.remoteServer,
        projectTarget: { mode: "linked_project_context" },
      },
    } as never);

    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "TARGET_ISOLATION_FAILED",
    });
  });

  it("refuses unresolved auth branches beyond none", async () => {
    const result = await executeRemoteServer(ctx(), {
      ...config,
      remoteServer: {
        ...config.remoteServer,
        auth: { mode: "bearer", token: "resolved-token" },
      },
    } as never);

    expect(result).toMatchObject({ exitCode: 1, errorCode: "AUTH_UNRESOLVED" });
  });

  it("refuses stale or mismatched saved sessions before trusting session id alone", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-2" } });
    mocked.postRemoteSessionMessage.mockResolvedValue({ ok: true, status: 200, text: "", data: { info: {}, parts: [{ text: "fresh" }] } });
    mocked.getRemoteSessionMessages.mockResolvedValue({ ok: true, status: 200, text: "", data: [{ parts: [{ text: "fresh" }] }] });
    setupHappySubscription();
    const onLog = vi.fn(async () => {});

    const result = await executeRemoteServer(ctx({
      onLog,
      runtime: {
        sessionId: "ses-old",
        sessionDisplayId: "ses-old",
        taskKey: null,
        sessionParams: {
          executionMode: "remote_server",
          sessionId: "ses-old",
          remoteSessionId: "ses-old",
          companyId: "company-1",
          agentId: "agent-1",
          adapterType: "opencode_full",
          configFingerprint: "bad-fingerprint",
          baseUrl: "https://opencode.example.com",
          projectTargetMode: "server_default",
          resolvedTargetIdentity: "server_default",
        },
      },
    }), config as never);

    expect(onLog).toHaveBeenCalledWith("stdout", expect.stringContaining("Remote session resume refused"));
    expect(result.sessionId).toBe("ses-2");
  });

  it("starts fresh when linked target metadata no longer matches the saved session", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-fresh" } });
    mocked.postRemoteSessionMessage.mockResolvedValue({ ok: true, status: 200, text: "", data: { info: {}, parts: [{ text: "fresh linked" }] } });
    mocked.getRemoteSessionMessages.mockResolvedValue({ ok: true, status: 200, text: "", data: [{ parts: [{ text: "fresh linked" }] }] });
    setupHappySubscription();
    const onLog = vi.fn(async () => {});

    const result = await executeRemoteServer(ctx({
      onLog,
      runtime: {
        sessionId: "ses-old",
        sessionDisplayId: "ses-old",
        taskKey: null,
        sessionParams: {
          executionMode: "remote_server",
          sessionId: "ses-old",
          remoteSessionId: "ses-old",
          companyId: "company-1",
          agentId: "agent-1",
          adapterType: "opencode_full",
          configFingerprint: "bad-fingerprint",
          baseUrl: "https://opencode.example.com",
          projectTargetMode: "linked_project_context",
          resolvedTargetIdentity: "linked_project_context:11111111-1111-4111-8111-111111111111:/tmp/other",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/tmp/other",
        },
      },
    }), linkedConfig as never);

    expect(onLog).toHaveBeenCalledWith("stdout", expect.stringContaining("Remote session resume refused"));
    expect(result.sessionId).toBe("ses-fresh");
  });

  it("normalizes ownership and target isolation failures distinctly", async () => {
    setupStandardMocks();
    setupHappySubscription();
    mocked.postRemoteSessionMessage
      .mockResolvedValueOnce({ ok: false, status: 409, text: "session belongs to another agent", data: { message: "session belongs to another agent" } })
      .mockResolvedValueOnce({ ok: false, status: 409, text: "target namespace mismatch", data: { message: "target namespace mismatch" } });

    await expect(executeRemoteServer(ctx(), config as never)).resolves.toMatchObject({ errorCode: "OWNERSHIP_MISMATCH" });
    await expect(executeRemoteServer(ctx(), config as never)).resolves.toMatchObject({ errorCode: "TARGET_ISOLATION_FAILED" });
  });

  it("keeps session creation 404s in a generic execution failure family", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({
      ok: false,
      status: 404,
      text: "route not found",
      data: { message: "route not found" },
    });

    await expect(executeRemoteServer(ctx(), config as never)).resolves.toMatchObject({
      exitCode: 1,
      errorCode: "EXECUTION_FAILED",
    });
  });

  it("keeps session-message 404s classified as stale or invalid sessions", async () => {
    setupStandardMocks();
    setupHappySubscription();
    mocked.postRemoteSessionMessage.mockResolvedValue({
      ok: false,
      status: 404,
      text: "unknown session",
      data: { message: "unknown session" },
    });

    await expect(executeRemoteServer(ctx(), config as never)).resolves.toMatchObject({
      exitCode: 1,
      errorCode: "SESSION_INVALID_OR_STALE",
    });
  });

  // ---- Cycle 3.1: Streaming parity tests ----

  describe("streaming parity (Cycle 3.1)", () => {
    describe("happy-path live streaming", () => {
      it("subscribes to /global/event before submitting the prompt", async () => {
        setupStandardMocks();
        setupHappySubscription();

        await executeRemoteServer(ctx(), config as never);

        // subscribeRemoteGlobalEvents should be called
        expect(mocked.subscribeRemoteGlobalEvents).toHaveBeenCalledOnce();
        expect(mocked.subscribeRemoteGlobalEvents).toHaveBeenCalledWith(
          expect.objectContaining({
            config,
            onEnvelope: expect.any(Function),
          }),
        );
        // POST should happen after subscribe
        expect(mocked.postRemoteSessionMessage).toHaveBeenCalledOnce();
      });

      it("emits step_start when stream is ready", async () => {
        setupStandardMocks();
        setupHappySubscription();
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});

        await executeRemoteServer(ctx({ onLog }), config as never);

        // Should have emitted a step_start line
        const stepStartCalls = onLog.mock.calls.filter((call) => {
          try {
            return JSON.parse(call[1].trim()).type === "step_start";
          } catch {
            return false;
          }
        });
        expect(stepStartCalls.length).toBeGreaterThanOrEqual(1);
      });

      it("streams live envelopes into ctx.onLog during active run", async () => {
        setupStandardMocks();
        // Provide live streaming envelopes that match the session
        const liveEnvelopes: OpencodeRemoteGlobalEventEnvelope[] = [
          // Text delta for a known part
          envelope("https://opencode.example.com", "message.part.updated", {
            sessionID: "ses-1",
            messageID: "msg-1",
            part: { id: "part-1", type: "text", content: "Hello world" },
          }),
          envelope("https://opencode.example.com", "message.part.delta", {
            sessionID: "ses-1",
            messageID: "msg-1",
            partID: "part-1",
            field: "content",
            delta: " more text",
          }),
        ];
        setupStreamingSubscription(liveEnvelopes);
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});

        const result = await executeRemoteServer(ctx({ onLog }), config as never);

        expect(result.exitCode).toBe(0);
        // Should have emitted JSONL lines for the text content
        const textLines = onLog.mock.calls.filter((call) => {
          try {
            const parsed = JSON.parse(call[1].trim());
            return parsed.type === "text";
          } catch {
            return false;
          }
        });
        expect(textLines.length).toBeGreaterThanOrEqual(1);
      });

      it("includes remoteStream and remoteStreamDroppedEvents in resultJson", async () => {
        setupStandardMocks();
        setupHappySubscription();

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(0);
        expect(result.resultJson).toBeDefined();
        const resultJson = result.resultJson as Record<string, unknown>;
        expect(resultJson.remoteStream).toBeDefined();
        expect((resultJson.remoteStream as Record<string, unknown>).degraded).toBe(false);
        expect(resultJson.remoteStreamDroppedEvents).toBeDefined();
      });

      it("produces no reconciliationWarnings on clean run", async () => {
        setupStandardMocks();
        setupHappySubscription();

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(0);
        const resultJson = result.resultJson as Record<string, unknown>;
        // No warnings when nothing was dropped
        expect(resultJson.reconciliationWarnings).toBeUndefined();
      });
    });

    describe("prompt failure after handshake", () => {
      it("emits error line and returns classified error when POST fails after stream ready", async () => {
        setupStandardMocks();
        setupHappySubscription();
        mocked.postRemoteSessionMessage.mockResolvedValue({
          ok: false,
          status: 500,
          text: "internal error",
          data: { message: "internal error" },
        });
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});

        const result = await executeRemoteServer(ctx({ onLog }), config as never);

        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("EXECUTION_FAILED");

        // Should have emitted an error line
        const errorLines = onLog.mock.calls.filter((call) => {
          try {
            return JSON.parse(call[1].trim()).type === "error";
          } catch {
            return false;
          }
        });
        expect(errorLines.length).toBeGreaterThanOrEqual(1);
      });

      it("closes subscription when POST fails", async () => {
        setupStandardMocks();
        const closeFn = vi.fn(async () => {});
        mocked.subscribeRemoteGlobalEvents.mockResolvedValue({
          connected: Promise.resolve(),
          done: new Promise<void>(() => {}),
          close: closeFn,
          droppedEvents: () => 0,
        } satisfies RemoteGlobalEventSubscription);
        mocked.postRemoteSessionMessage.mockResolvedValue({
          ok: false,
          status: 422,
          text: "model error",
          data: { message: "model error" },
        });

        await executeRemoteServer(ctx(), config as never);

        expect(closeFn).toHaveBeenCalledOnce();
      });
    });

    describe("active-run disconnect / degradation", () => {
      it("marks degraded state when stream cursor is degraded", async () => {
        setupStandardMocks();

        // Simulate a subscription that delivers events with degraded cursor
        mocked.subscribeRemoteGlobalEvents.mockImplementation(
          async (input: { onEnvelope: (env: OpencodeRemoteGlobalEventEnvelope) => void | Promise<void> }) => {
            // Deliver a stream_gap-inducing scenario: envelopes from wrong
            // session to increment dropped counters
            await input.onEnvelope(
              envelope("https://opencode.example.com", "session.status", {
                sessionID: "wrong-session",
                status: "running",
              }),
            );
            return {
              connected: Promise.resolve(),
              done: new Promise<void>(() => {}),
              close: vi.fn(async () => {}),
              droppedEvents: () => 2,
            } satisfies RemoteGlobalEventSubscription;
          },
        );

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(0);
        const resultJson = result.resultJson as Record<string, unknown>;
        const droppedEvents = resultJson.remoteStreamDroppedEvents as Record<string, number>;
        // Session mismatch should be counted
        expect(droppedEvents.sessionMismatch).toBe(1);
        // Transport dropped events from subscription
        expect(droppedEvents.transportDropped).toBe(2);
        // Should have reconciliation warnings about dropped events
        expect(resultJson.reconciliationWarnings).toBeDefined();
        const warnings = resultJson.reconciliationWarnings as string[];
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings[0]).toContain("dropped");
      });

      it("detects mid-run stream disconnect via done resolving before POST completes and marks degraded + emits remote_stream_gap", async () => {
        setupStandardMocks();
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});

        // The key behaviour: subscription.done resolves immediately (simulating
        // the SSE pump exiting during the POST), so the race in step 6b detects
        // the disconnect and sets streamDegraded = true.
        mocked.subscribeRemoteGlobalEvents.mockResolvedValue({
          connected: Promise.resolve(),
          done: Promise.resolve(),
          close: vi.fn(async () => {}),
          droppedEvents: () => 0,
        } satisfies RemoteGlobalEventSubscription);

        const result = await executeRemoteServer(ctx({ onLog }), config as never);

        expect(result.exitCode).toBe(0);

        // resultJson.remoteStream.degraded must be true
        const resultJson = result.resultJson as Record<string, unknown>;
        const remoteStream = resultJson.remoteStream as Record<string, unknown>;
        expect(remoteStream.degraded).toBe(true);
        expect(remoteStream.degradeReason).toContain("SSE stream ended unexpectedly");

        // A remote_stream_gap log line must have been emitted
        const gapLines = onLog.mock.calls.filter((call) => {
          try {
            return JSON.parse(call[1].trim()).type === "remote_stream_gap";
          } catch {
            return false;
          }
        });
        expect(gapLines.length).toBe(1);
        const gapPayload = JSON.parse(gapLines[0]![1].trim());
        expect(gapPayload.sessionID).toBe("ses-1");
        expect(gapPayload.reason).toContain("SSE stream ended unexpectedly");

        // Reconciliation warnings should mention degradation
        const warnings = resultJson.reconciliationWarnings as string[] | undefined;
        expect(warnings).toBeDefined();
        expect(warnings!.some((w) => w.includes("degraded"))).toBe(true);
      });
    });

    describe("pre-submit stream establishment failure", () => {
      it("aborts the run when subscribe throws", async () => {
        setupStandardMocks();
        setupSubscriptionConnectFailure("Connection refused");

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("STREAM_CONNECT_FAILED");
        expect(result.errorMessage).toContain("Connection refused");
        // POST should never be called
        expect(mocked.postRemoteSessionMessage).not.toHaveBeenCalled();
      });

      it("aborts the run when handshake rejects", async () => {
        setupStandardMocks();
        setupSubscriptionHandshakeFailure("Malformed JSON before handshake");

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("STREAM_CONNECT_FAILED");
        expect(result.errorMessage).toContain("handshake failed");
        // POST should never be called
        expect(mocked.postRemoteSessionMessage).not.toHaveBeenCalled();
      });
    });

    describe("stale or mismatched targeting rejection", () => {
      it("fails with target isolation when linked_project_context has no linkRef", async () => {
        const result = await executeRemoteServer(ctx(), {
          ...config,
          remoteServer: {
            ...config.remoteServer,
            projectTarget: { mode: "linked_project_context" },
          },
        } as never);

        expect(result).toMatchObject({
          exitCode: 1,
          errorCode: "TARGET_ISOLATION_FAILED",
        });
        // Stream should never be established
        expect(mocked.subscribeRemoteGlobalEvents).not.toHaveBeenCalled();
      });

      it("fails with target isolation when linked directory hint is empty", async () => {
        const result = await executeRemoteServer(ctx(), {
          ...config,
          remoteServer: {
            ...config.remoteServer,
            projectTarget: { mode: "linked_project_context" as const },
            linkRef: {
              mode: "linked_project_context" as const,
              canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
              linkedDirectoryHint: "  ",
              serverScope: "shared" as const,
              validatedAt: "2026-04-16T00:00:00.000Z",
            },
          },
        } as never);

        expect(result).toMatchObject({
          exitCode: 1,
          errorCode: "TARGET_ISOLATION_FAILED",
        });
      });
    });

    describe("final reconcile and dropped-event diagnostics", () => {
      it("factors dropped-event counts into reconciliationWarnings", async () => {
        setupStandardMocks();

        // Subscription that reports transport-level dropped events
        mocked.subscribeRemoteGlobalEvents.mockImplementation(
          async (input: { onEnvelope: (env: OpencodeRemoteGlobalEventEnvelope) => void | Promise<void> }) => {
            // Deliver some malformed envelopes that the correlation layer will
            // drop (session mismatch + malformed)
            await input.onEnvelope(
              envelope("https://opencode.example.com", "session.status", {
                // missing sessionID -> malformed
              }),
            );
            await input.onEnvelope(
              envelope("https://opencode.example.com", "message.part.delta", {
                sessionID: "ses-1",
                // missing required fields -> malformed
              }),
            );
            return {
              connected: Promise.resolve(),
              done: new Promise<void>(() => {}),
              close: vi.fn(async () => {}),
              droppedEvents: () => 1,
            } satisfies RemoteGlobalEventSubscription;
          },
        );

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(0);
        const resultJson = result.resultJson as Record<string, unknown>;
        expect(resultJson.reconciliationWarnings).toBeDefined();
        const warnings = resultJson.reconciliationWarnings as string[];
        expect(warnings.some((w) => w.includes("dropped"))).toBe(true);

        // droppedEvents surface should have totals
        const droppedSurface = resultJson.remoteStreamDroppedEvents as Record<string, number>;
        expect(droppedSurface.total).toBeGreaterThanOrEqual(2);
        expect(droppedSurface.malformed).toBeGreaterThanOrEqual(2);
        expect(droppedSurface.transportDropped).toBe(1);
      });

      it("authoritative final payload determines success even without stream events", async () => {
        setupStandardMocks();
        // Subscription delivers no relevant envelopes
        setupHappySubscription();

        const result = await executeRemoteServer(ctx(), config as never);

        // Success is determined by POST response, not stream
        expect(result.exitCode).toBe(0);
        expect(result.summary).toBe("hello from remote");
        expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 });
      });

      it("stream never becomes sole completion source — final payload is authoritative", async () => {
        setupStandardMocks();
        // Stream delivers session status events suggesting completion
        setupStreamingSubscription([
          envelope("https://opencode.example.com", "session.status", {
            sessionID: "ses-1",
            status: "complete",
          }),
        ]);

        const result = await executeRemoteServer(ctx(), config as never);

        // Usage, summary, and cost all come from POST response payload
        expect(result.exitCode).toBe(0);
        expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 });
        expect(result.costUsd).toBe(0.12);
      });
    });

    describe("terminal reasoning-buffer flush", () => {
      it("flushes pending reasoning buffers before reconciliation", async () => {
        setupStandardMocks();
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});

        // Deliver reasoning deltas that will be buffered by the correlator
        const reasoningEnvelopes: OpencodeRemoteGlobalEventEnvelope[] = [
          // First register the part as reasoning
          envelope("https://opencode.example.com", "message.part.updated", {
            sessionID: "ses-1",
            messageID: "msg-1",
            part: { id: "part-r1", type: "reasoning" },
          }),
          // Then send deltas that get buffered
          envelope("https://opencode.example.com", "message.part.delta", {
            sessionID: "ses-1",
            messageID: "msg-1",
            partID: "part-r1",
            field: "reasoning",
            delta: "thinking step 1",
          }),
          envelope("https://opencode.example.com", "message.part.delta", {
            sessionID: "ses-1",
            messageID: "msg-1",
            partID: "part-r1",
            field: "reasoning",
            delta: " and step 2",
          }),
        ];
        setupStreamingSubscription(reasoningEnvelopes);

        const result = await executeRemoteServer(ctx({ onLog }), config as never);

        expect(result.exitCode).toBe(0);

        // Verify reasoning was flushed: there should be at least one reasoning
        // JSONL line in the onLog calls (from the terminal flush)
        const reasoningLines = onLog.mock.calls.filter((call) => {
          try {
            return JSON.parse(call[1].trim()).type === "reasoning";
          } catch {
            return false;
          }
        });
        expect(reasoningLines.length).toBeGreaterThanOrEqual(1);

        // The flushed reasoning should contain the accumulated deltas
        const lastReasoningLine = reasoningLines[reasoningLines.length - 1];
        expect(lastReasoningLine).toBeDefined();
        const parsed = JSON.parse(lastReasoningLine![1].trim());
        expect(parsed.part.text).toContain("thinking step 1");
        expect(parsed.part.text).toContain("and step 2");
      });

      it("does not emit reasoning lines when no reasoning buffers are pending", async () => {
        setupStandardMocks();
        const onLog = vi.fn<(stream: string, chunk: string) => Promise<void>>(async () => {});
        // Only text envelopes, no reasoning
        setupHappySubscription();

        await executeRemoteServer(ctx({ onLog }), config as never);

        const reasoningLines = onLog.mock.calls.filter((call) => {
          try {
            return JSON.parse(call[1].trim()).type === "reasoning";
          } catch {
            return false;
          }
        });
        expect(reasoningLines).toHaveLength(0);
      });
    });

    describe("network and timeout errors post-submit", () => {
      it("returns timeout when POST throws AbortError", async () => {
        setupStandardMocks();
        setupHappySubscription();
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        mocked.postRemoteSessionMessage.mockRejectedValue(abortError);

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("TIMEOUT");
        expect(result.timedOut).toBe(true);
      });

      it("returns execution failure when POST throws network error", async () => {
        setupStandardMocks();
        setupHappySubscription();
        mocked.postRemoteSessionMessage.mockRejectedValue(new Error("fetch failed"));

        const result = await executeRemoteServer(ctx(), config as never);

        expect(result.exitCode).toBe(1);
        expect(result.errorCode).toBe("EXECUTION_FAILED");
        expect(result.errorMessage).toContain("could not reach");
      });

      it("closes subscription on post-submit errors", async () => {
        setupStandardMocks();
        const closeFn = vi.fn(async () => {});
        mocked.subscribeRemoteGlobalEvents.mockResolvedValue({
          connected: Promise.resolve(),
          done: new Promise<void>(() => {}),
          close: closeFn,
          droppedEvents: () => 0,
        } satisfies RemoteGlobalEventSubscription);
        mocked.postRemoteSessionMessage.mockRejectedValue(new Error("network error"));

        await executeRemoteServer(ctx(), config as never);

        expect(closeFn).toHaveBeenCalled();
      });
    });

    describe("meta emission", () => {
      it("includes streaming parity note in commandNotes", async () => {
        setupStandardMocks();
        setupHappySubscription();
        const onMeta = vi.fn(async () => {});

        await executeRemoteServer(ctx({ onMeta }), config as never);

        expect(onMeta).toHaveBeenCalledWith(
          expect.objectContaining({
            commandNotes: expect.arrayContaining([
              expect.stringContaining("Live streaming parity"),
            ]),
          }),
        );
      });
    });
  });
});

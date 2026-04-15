import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const mocked = vi.hoisted(() => ({
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: vi.fn(),
  createRemoteSession: vi.fn(),
  getRemoteSession: vi.fn(),
  getRemoteSessionMessages: vi.fn(),
  getRemoteSessionStatus: vi.fn(),
  postRemoteSessionMessage: vi.fn(),
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
  };
});

import { executeRemoteServer } from "./remote-execute.js";

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

describe("opencode_full remote execute", () => {
  afterEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset());
  });

  it("uses canonical session create + message + message read flow", async () => {
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

  it("normalizes ownership and target isolation failures distinctly", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-1" } });
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
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-1" } });
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
});

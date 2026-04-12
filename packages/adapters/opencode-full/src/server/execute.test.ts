import { afterEach, describe, expect, it, vi } from "vitest";

const ensureAbsoluteDirectory = vi.fn();
const ensureCommandResolvable = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);
const resolveCommandForLogs = vi.fn(async (command: string) => command);
const runChildProcess = vi.fn();
const prepareLocalCliRuntimeConfig = vi.fn();
const ensureLocalCliOpenCodeModelConfiguredAndAvailable = vi.fn();
const ensureRemoteServerOpenCodeModelConfiguredAndAvailable = vi.fn();

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureAbsoluteDirectory,
    ensureCommandResolvable,
    ensurePathInEnv,
    resolveCommandForLogs,
    runChildProcess,
  };
});

vi.mock("./models.js", () => ({
  prepareLocalCliRuntimeConfig,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
}));

import { executeLocalCli, executeRemoteServer } from "./execute.js";
import { sessionCodec } from "./index.js";

const localCliConfig = {
  executionMode: "local_cli" as const,
  model: "openai/gpt-5.4",
  variant: "fast",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  promptTemplate: "You are {{agent.id}}.",
  localCli: {
    command: "opencode",
    allowProjectConfig: true,
    dangerouslySkipPermissions: false,
    graceSec: 5,
    env: {},
  },
};

const remoteServerConfig = {
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
    auth: { mode: "bearer" as const, token: "resolved-token" },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const, requireDedicatedServer: false },
  },
};

function createExecutionContext(overrides: Partial<Parameters<typeof executeLocalCli>[0]> = {}) {
  return {
    runId: "run-1",
    agent: { id: "agent-1", name: "Agent 1", companyId: "company-1" },
    runtime: { sessionId: null, sessionParams: null },
    config: localCliConfig,
    context: {
      paperclipWorkspace: {
        workspaceId: "workspace-1",
        cwd: "/repo/worktree",
        repoUrl: "https://example.com/acme/repo.git",
        repoRef: "feature/worktree",
      },
    },
    onLog: vi.fn(async () => {}),
    onMeta: vi.fn(async () => {}),
    onSpawn: vi.fn(async () => {}),
    authToken: "paperclip-auth-token",
    ...overrides,
  } as never;
}

describe("opencode_full local_cli execute", () => {
  afterEach(() => {
    ensureAbsoluteDirectory.mockReset();
    ensureCommandResolvable.mockReset();
    ensurePathInEnv.mockClear();
    resolveCommandForLogs.mockClear();
    runChildProcess.mockReset();
    prepareLocalCliRuntimeConfig.mockReset();
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockReset();
    vi.unstubAllGlobals();
  });

  it("normalizes a successful local_cli execution result", async () => {
    const cleanup = vi.fn(async () => {});
    ensureAbsoluteDirectory.mockResolvedValue(undefined);
    ensureCommandResolvable.mockResolvedValue(undefined);
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: { FROM_RUNTIME_CONFIG: "1" }, notes: ["note-1"], cleanup });
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({ sessionID: "session-1", type: "text", part: { text: "hello from OpenCode" } }),
        JSON.stringify({ type: "step_finish", part: { tokens: { input: 12, output: 7, reasoning: 3, cache: { read: 2 } }, cost: 0.42 } }),
      ].join("\n"),
      stderr: "",
    });

    const result = await executeLocalCli(createExecutionContext(), localCliConfig);

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      errorMessage: null,
      sessionId: "session-1",
      sessionDisplayId: "session-1",
      provider: "openai",
      model: "openai/gpt-5.4",
      costUsd: 0.42,
      summary: "hello from OpenCode",
      usage: {
        inputTokens: 12,
        outputTokens: 10,
        cachedInputTokens: 2,
      },
      sessionParams: {
        executionMode: "local_cli",
        sessionId: "session-1",
        cwd: "/repo/worktree",
        workspaceId: "workspace-1",
        repoUrl: "https://example.com/acme/repo.git",
        repoRef: "feature/worktree",
      },
    });
    expect(runChildProcess).toHaveBeenCalledWith(
      "run-1",
      "opencode",
      ["run", "--format", "json", "--model", "openai/gpt-5.4", "--variant", "fast"],
      expect.objectContaining({ cwd: "/repo/worktree", stdin: expect.stringContaining("You are agent-1.") }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sessionCodec.deserialize(result.sessionParams ?? null)).toEqual(result.sessionParams);
  });

  it("ignores invalid saved session params and starts fresh", async () => {
    const onLog = vi.fn(async () => {});
    ensureAbsoluteDirectory.mockResolvedValue(undefined);
    ensureCommandResolvable.mockResolvedValue(undefined);
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({ sessionID: "fresh-session", type: "text", part: { text: "ok" } }),
      stderr: "",
    });

    await executeLocalCli(createExecutionContext({ runtime: { sessionId: "bad-session", sessionParams: { remoteSessionId: "remote-1" } }, onLog }), localCliConfig);

    expect(runChildProcess).toHaveBeenCalledWith(
      "run-1",
      "opencode",
      ["run", "--format", "json", "--model", "openai/gpt-5.4", "--variant", "fast"],
      expect.any(Object),
    );
    expect(onLog).toHaveBeenCalledWith(
      "stdout",
      expect.stringContaining("Existing session params are invalid for opencode_full local_cli and will be ignored."),
    );
  });

  it("retries with a fresh session when the saved session is stale", async () => {
    const onLog = vi.fn(async () => {});
    ensureAbsoluteDirectory.mockResolvedValue(undefined);
    ensureCommandResolvable.mockResolvedValue(undefined);
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    runChildProcess
      .mockResolvedValueOnce({
        exitCode: 1,
        signal: null,
        timedOut: false,
        stdout: JSON.stringify({ type: "error", error: { message: "unknown session" } }),
        stderr: "unknown session",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: [
          JSON.stringify({ sessionID: "fresh-session", type: "text", part: { text: "recovered" } }),
        ].join("\n"),
        stderr: "",
      });

    const result = await executeLocalCli(
      createExecutionContext({
        runtime: {
          sessionId: "stale-session",
          sessionParams: { executionMode: "local_cli", sessionId: "stale-session", cwd: "/repo/worktree" },
        },
        onLog,
      }),
      localCliConfig,
    );

    expect(runChildProcess).toHaveBeenNthCalledWith(
      1,
      "run-1",
      "opencode",
      ["run", "--format", "json", "--session", "stale-session", "--model", "openai/gpt-5.4", "--variant", "fast"],
      expect.any(Object),
    );
    expect(runChildProcess).toHaveBeenNthCalledWith(
      2,
      "run-1",
      "opencode",
      ["run", "--format", "json", "--model", "openai/gpt-5.4", "--variant", "fast"],
      expect.any(Object),
    );
    expect(onLog).toHaveBeenCalledWith(
      "stdout",
      expect.stringContaining("retrying with a fresh session"),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "fresh-session",
      clearSession: true,
      summary: "recovered",
    });
  });

  it("normalizes a minimal remote server_default execution and persists remote ownership", async () => {
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        sessionId: "remote-session-1",
        outputText: "hello from remote",
        usage: { inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 },
        costUsd: 0.12,
        warnings: ["remote warning"],
        transcript: [
          { type: "step_start", sessionID: "remote-session-1" },
          { type: "text", part: { text: "hello from remote" } },
          { type: "tool_use", part: { tool: "read", callID: "tool-1", state: { status: "completed", output: "done" } } },
        ],
        resultJson: { transcript: [] },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeRemoteServer(createExecutionContext(), remoteServerConfig as never);

    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "remote-session-1",
      sessionDisplayId: "remote-session-1",
      summary: "hello from remote",
      model: "openai/gpt-5.4",
      usage: { inputTokens: 4, outputTokens: 9, cachedInputTokens: 1 },
      errorMeta: expect.objectContaining({ executionMode: "remote_server", warnings: ["remote warning"] }),
    });
    expect(result.sessionParams).toMatchObject({
      remoteSessionId: "remote-session-1",
      baseUrl: "https://opencode.example.com",
      projectTargetMode: "server_default",
      resolvedTargetIdentity: "server-default",
      ownership: {
        companyId: "company-1",
        agentId: "agent-1",
        executionMode: "remote_server",
      },
    });
    expect(result.resultJson).toMatchObject({
      requestedTarget: "server-default",
      warnings: ["remote warning"],
      transcript: expect.any(Array),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.example.com/sessions/execute",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resolved-token" }),
      }),
    );
  });

  it("refuses remote resume when any gating field changes", async () => {
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sessionId: "remote-session-2", summary: "fresh" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onLog = vi.fn(async () => {});

    const result = await executeRemoteServer(
      createExecutionContext({
        runtime: {
          sessionId: "remote-session-1",
          sessionDisplayId: "remote-session-1",
          taskKey: null,
          sessionParams: {
            ownership: {
              companyId: "company-1",
              agentId: "agent-1",
              adapterType: "opencode_full",
              executionMode: "remote_server",
              configFingerprint: JSON.stringify({ changed: false }),
            },
            baseUrl: "https://opencode.example.com",
            remoteSessionId: "remote-session-1",
            projectTargetMode: "server_default",
            resolvedTargetIdentity: "server-default",
            canonicalWorkspaceId: null,
            canonicalWorkspaceCwd: null,
            serverScope: "unknown",
            createdAt: "2026-04-11T12:00:00.000Z",
          },
        },
        onLog,
      }),
      remoteServerConfig as never,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(body.sessionId).toBeNull();
    expect(onLog).toHaveBeenCalledWith("stdout", expect.stringContaining("Remote session resume refused"));
    expect(result.sessionId).toBe("remote-session-2");
  });

  it("fails clearly for unsupported remote target modes", async () => {
    const result = await executeRemoteServer(
      createExecutionContext(),
      {
        ...remoteServerConfig,
        remoteServer: {
          ...remoteServerConfig.remoteServer,
          projectTarget: { mode: "fixed_path", projectPath: "/srv/shared/company-a", requireDedicatedServer: false },
        },
      } as never,
    );

    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "TARGET_MODE_UNSUPPORTED_SHARED_SERVER_PATH",
    });
  });

  it("distinguishes remote ownership and target-isolation failures clearly", async () => {
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ errorCode: "REMOTE_OWNERSHIP_MISMATCH", message: "session belongs to another agent" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ errorCode: "REMOTE_TARGET_ISOLATION_FAILED", message: "target namespace mismatch" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(executeRemoteServer(createExecutionContext(), remoteServerConfig as never)).resolves.toMatchObject({
      exitCode: 1,
      errorCode: "REMOTE_OWNERSHIP_MISMATCH",
      errorMessage: "session belongs to another agent",
    });

    await expect(executeRemoteServer(createExecutionContext(), remoteServerConfig as never)).resolves.toMatchObject({
      exitCode: 1,
      errorCode: "REMOTE_TARGET_ISOLATION_FAILED",
      errorMessage: "target namespace mismatch",
    });
  });
});

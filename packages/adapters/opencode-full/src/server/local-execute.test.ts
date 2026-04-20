import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const mocked = vi.hoisted(() => ({
  ensureAbsoluteDirectory: vi.fn(),
  ensureCommandResolvable: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
  resolveCommandForLogs: vi.fn(async (command: string) => command),
  runChildProcess: vi.fn(),
  prepareLocalCliRuntimeConfig: vi.fn(),
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureAbsoluteDirectory: mocked.ensureAbsoluteDirectory,
    ensureCommandResolvable: mocked.ensureCommandResolvable,
    ensurePathInEnv: mocked.ensurePathInEnv,
    resolveCommandForLogs: mocked.resolveCommandForLogs,
    runChildProcess: mocked.runChildProcess,
  };
});

vi.mock("./local-models.js", () => ({
  prepareLocalCliRuntimeConfig: mocked.prepareLocalCliRuntimeConfig,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable,
}));

import { executeLocalCli } from "./local-execute.js";
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

function createExecutionContext(overrides: Partial<AdapterExecutionContext> = {}) {
  const runtime = {
    sessionId: null,
    sessionParams: null,
    sessionDisplayId: null,
    taskKey: null,
    ...(overrides.runtime ?? {}),
  };

  return {
    runId: "run-1",
    agent: { id: "agent-1", name: "Agent 1", companyId: "company-1" },
    runtime,
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

describe("opencode_full local_cli local-execute", () => {
  afterEach(() => {
    mocked.ensureAbsoluteDirectory.mockReset();
    mocked.ensureCommandResolvable.mockReset();
    mocked.ensurePathInEnv.mockClear();
    mocked.resolveCommandForLogs.mockClear();
    mocked.runChildProcess.mockReset();
    mocked.prepareLocalCliRuntimeConfig.mockReset();
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
  });

  it("normalizes a successful local_cli execution result", async () => {
    const cleanup = vi.fn(async () => {});
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: { FROM_RUNTIME_CONFIG: "1" }, notes: ["note-1"], cleanup });
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.runChildProcess.mockResolvedValue({
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
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sessionCodec.deserialize(result.sessionParams ?? null)).toEqual(result.sessionParams);
  });

  it("does not fail a successful run when only tool calls error", async () => {
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: [
        JSON.stringify({
          type: "tool_use",
          part: { state: { status: "error", error: "File not found: /repo/worktree/docs/engineering/README.md" } },
        }),
        JSON.stringify({ sessionID: "session-2", type: "text", part: { text: "delegated successfully" } }),
      ].join("\n"),
      stderr: "",
    });

    const result = await executeLocalCli(createExecutionContext(), localCliConfig);

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false,
      errorMessage: null,
      summary: "delegated successfully",
      resultJson: expect.objectContaining({
        toolErrors: ["File not found: /repo/worktree/docs/engineering/README.md"],
      }),
      errorMeta: expect.objectContaining({
        toolErrors: ["File not found: /repo/worktree/docs/engineering/README.md"],
      }),
    });
  });

  it("normalizes command failures into shared error families", async () => {
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockRejectedValue(new Error("Command not found: opencode"));
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });

    const result = await executeLocalCli(createExecutionContext(), localCliConfig);

    expect(result).toMatchObject({
      exitCode: 1,
      timedOut: false,
      errorCode: "UNAVAILABLE",
      errorMessage: "Command not found: opencode",
    });
  });

  it("normalizes configured-model failures to MODEL_INVALID", async () => {
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockRejectedValue(
      new Error("Configured OpenCode model is unavailable: openai/gpt-5.4"),
    );

    const result = await executeLocalCli(createExecutionContext(), localCliConfig);

    expect(result).toMatchObject({
      exitCode: 1,
      timedOut: false,
      errorCode: "MODEL_INVALID",
      errorMessage: "Configured OpenCode model is unavailable: openai/gpt-5.4",
    });
    expect(mocked.runChildProcess).not.toHaveBeenCalled();
  });

  it("ignores invalid saved session params and starts fresh", async () => {
    const onLog = vi.fn(async () => {});
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.runChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: JSON.stringify({ sessionID: "fresh-session", type: "text", part: { text: "ok" } }),
      stderr: "",
    });

    await executeLocalCli(createExecutionContext({ runtime: { sessionId: "bad-session", sessionParams: { remoteSessionId: "remote-1" }, sessionDisplayId: null, taskKey: null }, onLog }), localCliConfig);

    expect(onLog).toHaveBeenCalledWith(
      "stdout",
      expect.stringContaining("Existing session params are invalid for opencode_full local_cli and will be ignored."),
    );
  });

  it("retries with a fresh session when the saved session is stale", async () => {
    const onLog = vi.fn(async () => {});
    mocked.ensureAbsoluteDirectory.mockResolvedValue(undefined);
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.runChildProcess
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
          sessionDisplayId: "stale-session",
          taskKey: null,
        },
        onLog,
      }),
      localCliConfig,
    );

    expect(onLog).toHaveBeenCalledWith(
      "stdout",
      expect.stringContaining("retrying with a fresh session"),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "fresh-session",
      clearSession: false,
      summary: "recovered",
    });
  });
});

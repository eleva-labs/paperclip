import { afterEach, describe, expect, it, vi } from "vitest";

const ensureAbsoluteDirectory = vi.fn();
const ensureCommandResolvable = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);
const resolveCommandForLogs = vi.fn(async (command: string) => command);
const runChildProcess = vi.fn();
const prepareLocalCliRuntimeConfig = vi.fn();
const ensureLocalCliOpenCodeModelConfiguredAndAvailable = vi.fn();

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
}));

import { executeLocalCli } from "./execute.js";
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
});

import { afterEach, describe, expect, it, vi } from "vitest";

const prepareProjectAwareOpenCodeRuntimeConfig = vi.fn();
const runChildProcess = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensurePathInEnv,
    runChildProcess,
  };
});

vi.mock("./runtime-config.js", () => ({
  prepareProjectAwareOpenCodeRuntimeConfig,
}));

import {
  discoverProjectAwareOpenCodeModels,
  ensureProjectAwareOpenCodeModelConfiguredAndAvailable,
  listProjectAwareOpenCodeModels,
  resetProjectAwareOpenCodeModelsCacheForTests,
} from "./models.js";

describe("project-aware OpenCode models", () => {
  afterEach(() => {
    prepareProjectAwareOpenCodeRuntimeConfig.mockReset();
    runChildProcess.mockReset();
    ensurePathInEnv.mockClear();
    resetProjectAwareOpenCodeModelsCacheForTests();
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
  });

  it("parses, dedupes, sorts, and cleans up model discovery output", async () => {
    const cleanup = vi.fn(async () => {});
    prepareProjectAwareOpenCodeRuntimeConfig.mockResolvedValue({
      env: { FROM_RUNTIME_CONFIG: "1" },
      notes: [],
      cleanup,
    });
    runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 0,
      stdout: [
        "anthropic/claude-3-7-sonnet extra columns",
        "invalid-line",
        "openai/gpt-5.4",
        "anthropic/claude-3-7-sonnet",
        "openai/gpt-4.1",
      ].join("\n"),
      stderr: "",
    });

    const models = await discoverProjectAwareOpenCodeModels({
      command: "custom-opencode",
      cwd: "/repo/worktree",
      env: { CUSTOM_ENV: "yes" },
      config: { allowProjectConfig: true },
    });

    expect(models).toEqual([
      { id: "anthropic/claude-3-7-sonnet", label: "anthropic/claude-3-7-sonnet" },
      { id: "openai/gpt-4.1", label: "openai/gpt-4.1" },
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
    expect(prepareProjectAwareOpenCodeRuntimeConfig).toHaveBeenCalledWith({
      cwd: "/repo/worktree",
      env: { CUSTOM_ENV: "yes" },
      config: { allowProjectConfig: true },
    });
    expect(runChildProcess).toHaveBeenCalledWith(
      expect.stringMatching(/^opencode-project-models-/),
      "custom-opencode",
      ["models"],
      expect.objectContaining({
        cwd: "/repo/worktree",
        env: expect.objectContaining({ CUSTOM_ENV: "yes", FROM_RUNTIME_CONFIG: "1" }),
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("reports configured model discovery failures with workspace metadata", async () => {
    const cleanup = vi.fn(async () => {});
    prepareProjectAwareOpenCodeRuntimeConfig.mockResolvedValue({
      env: {},
      notes: [],
      cleanup,
    });
    runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 0,
      stdout: ["openai/gpt-4.1", "anthropic/claude-3-7-sonnet"].join("\n"),
      stderr: "",
    });

    await expect(
      ensureProjectAwareOpenCodeModelConfiguredAndAvailable({
        model: "openai/gpt-5.4",
        cwd: "/repo/canonical",
        runtimeMetadata: {
          canonicalWorkspaceId: "workspace-canonical",
          canonicalWorkspaceCwd: "/repo/canonical",
          executionWorkspaceId: "workspace-worktree",
          executionWorkspaceSource: "git_worktree",
        },
      }),
    ).rejects.toThrow(
      /Configured OpenCode model is unavailable: openai\/gpt-5\.4\. Available models: anthropic\/claude-3-7-sonnet, openai\/gpt-4\.1 \(canonicalWorkspaceId=workspace-canonical, canonicalWorkspaceCwd=\/repo\/canonical, executionWorkspaceId=workspace-worktree, executionWorkspaceSource=git_worktree\)/,
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when model discovery cannot run", async () => {
    const cleanup = vi.fn(async () => {});
    prepareProjectAwareOpenCodeRuntimeConfig.mockResolvedValue({
      env: {},
      notes: [],
      cleanup,
    });
    runChildProcess.mockRejectedValue(new Error("Failed to start command: opencode"));

    await expect(listProjectAwareOpenCodeModels()).resolves.toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

const ensureAbsoluteDirectory = vi.fn();
const ensureCommandResolvable = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);
const runChildProcess = vi.fn();
const prepareProjectAwareOpenCodeRuntimeConfig = vi.fn();
const discoverProjectAwareOpenCodeModels = vi.fn();
const ensureProjectAwareOpenCodeModelConfiguredAndAvailable = vi.fn();

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureAbsoluteDirectory,
    ensureCommandResolvable,
    ensurePathInEnv,
    runChildProcess,
  };
});

vi.mock("./runtime-config.js", () => ({
  prepareProjectAwareOpenCodeRuntimeConfig,
}));

vi.mock("./models.js", () => ({
  discoverProjectAwareOpenCodeModels,
  ensureProjectAwareOpenCodeModelConfiguredAndAvailable,
}));

import { testEnvironment } from "./test.js";

describe("testEnvironment", () => {
  afterEach(() => {
    ensureAbsoluteDirectory.mockReset();
    ensureCommandResolvable.mockReset();
    ensurePathInEnv.mockClear();
    runChildProcess.mockReset();
    prepareProjectAwareOpenCodeRuntimeConfig.mockReset();
    discoverProjectAwareOpenCodeModels.mockReset();
    ensureProjectAwareOpenCodeModelConfiguredAndAvailable.mockReset();
  });

  it("passes with discovered models, a valid configured model, and a hello probe", async () => {
    const cleanup = vi.fn(async () => {});
    ensureAbsoluteDirectory.mockResolvedValue(undefined);
    ensureCommandResolvable.mockResolvedValue(undefined);
    prepareProjectAwareOpenCodeRuntimeConfig.mockResolvedValue({
      env: { FROM_RUNTIME_CONFIG: "1" },
      notes: [],
      cleanup,
    });
    discoverProjectAwareOpenCodeModels.mockResolvedValue([
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
      { id: "anthropic/claude-3-7-sonnet", label: "anthropic/claude-3-7-sonnet" },
    ]);
    ensureProjectAwareOpenCodeModelConfiguredAndAvailable.mockResolvedValue([
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
    runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 0,
      stdout: '{"type":"text","part":{"text":"hello from OpenCode"}}\n',
      stderr: "",
    });

    const result = await testEnvironment({
      adapterType: "opencode_project_local",
      config: {
        command: "opencode",
        cwd: "/repo/canonical",
        model: "openai/gpt-5.4",
        variant: "fast",
        extraArgs: ["--sandbox", "danger-full-access"],
      },
    } as never);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "opencode_project_runtime_metadata", level: "info" }),
        expect.objectContaining({ code: "opencode_models_discovered", level: "info" }),
        expect.objectContaining({ code: "opencode_model_configured", level: "info", message: "Configured model: openai/gpt-5.4" }),
        expect.objectContaining({ code: "opencode_hello_probe_passed", level: "info" }),
      ]),
    );
    expect(discoverProjectAwareOpenCodeModels).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "opencode",
        cwd: "/repo/canonical",
        env: expect.objectContaining({ FROM_RUNTIME_CONFIG: "1" }),
        runtimeMetadata: expect.objectContaining({ executionWorkspaceSource: "adapter_fallback" }),
      }),
    );
    expect(ensureProjectAwareOpenCodeModelConfiguredAndAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-5.4",
        command: "opencode",
        cwd: "/repo/canonical",
      }),
    );
    expect(runChildProcess).toHaveBeenCalledWith(
      expect.stringMatching(/^opencode-project-envtest-/),
      "opencode",
      ["run", "--format", "json", "--model", "openai/gpt-5.4", "--variant", "fast", "--sandbox", "danger-full-access"],
      expect.objectContaining({
        cwd: "/repo/canonical",
        env: expect.objectContaining({ FROM_RUNTIME_CONFIG: "1" }),
        stdin: "Respond with hello.",
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("reports adapter-config-only canonical diagnostics and auth-required probe warnings truthfully", async () => {
    const cleanup = vi.fn(async () => {});
    ensureAbsoluteDirectory.mockResolvedValue(undefined);
    ensureCommandResolvable.mockResolvedValue(undefined);
    prepareProjectAwareOpenCodeRuntimeConfig.mockResolvedValue({
      env: {},
      notes: [],
      cleanup,
    });
    discoverProjectAwareOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    ensureProjectAwareOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 1,
      stdout: '{"type":"error","error":{"message":"authentication required"}}\n',
      stderr: "Please run opencode auth login",
    });

    const result = await testEnvironment({
      adapterType: "opencode_project_local",
      config: {
        cwd: "/repo/canonical",
        model: "openai/gpt-5.4",
        canonicalWorkspaceOnly: true,
      },
    } as never);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "opencode_project_runtime_metadata_unavailable",
          level: "error",
        }),
        expect.objectContaining({
          code: "opencode_hello_probe_auth_required",
          level: "warn",
          message: "OpenCode is installed, but provider authentication is not ready.",
        }),
      ]),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

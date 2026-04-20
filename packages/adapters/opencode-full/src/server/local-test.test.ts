import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  ensureCommandResolvable: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
  discoverLocalCliOpenCodeModels: vi.fn(),
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: vi.fn(),
  prepareLocalCliRuntimeConfig: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable: mocked.ensureCommandResolvable,
    ensurePathInEnv: mocked.ensurePathInEnv,
  };
});

vi.mock("./local-models.js", () => ({
  discoverLocalCliOpenCodeModels: mocked.discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig: mocked.prepareLocalCliRuntimeConfig,
}));

import { testLocalCliEnvironment } from "./local-test.js";

const localCliConfig = {
  executionMode: "local_cli" as const,
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  localCli: {
    command: "opencode",
    allowProjectConfig: true,
    dangerouslySkipPermissions: false,
    graceSec: 5,
    env: {},
  },
};

describe("opencode_full local_cli local-test", () => {
  afterEach(() => {
    mocked.ensureCommandResolvable.mockReset();
    mocked.ensurePathInEnv.mockClear();
    mocked.discoverLocalCliOpenCodeModels.mockReset();
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
    mocked.prepareLocalCliRuntimeConfig.mockReset();
  });

  it("reports command present and configured model valid without claiming workspace readiness", async () => {
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: { FROM_RUNTIME_CONFIG: "1" }, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_full_config_valid", level: "info" }),
      expect.objectContaining({ code: "opencode_local_cli_command_found", level: "info" }),
      expect.objectContaining({ code: "opencode_local_cli_model_valid", level: "info" }),
    ]));
    expect(result.checks[0]?.detail).toMatch(/does not claim workspace-aware runtime readiness/i);
  });

  it("uses config-only discovery inputs instead of ambient project cwd/config", async () => {
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: { FROM_RUNTIME_CONFIG: "1" }, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(mocked.prepareLocalCliRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({
      cwd: expect.any(String),
      config: expect.objectContaining({
        localCli: expect.objectContaining({ allowProjectConfig: false }),
      }),
    }));
    expect(mocked.prepareLocalCliRuntimeConfig.mock.calls[0]?.[0]?.cwd).not.toBe(process.cwd());
    expect(mocked.discoverLocalCliOpenCodeModels).toHaveBeenCalledWith(expect.objectContaining({
      cwd: mocked.prepareLocalCliRuntimeConfig.mock.calls[0]?.[0]?.cwd,
      config: expect.objectContaining({
        localCli: expect.objectContaining({ allowProjectConfig: false }),
      }),
    }));
    expect(mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable).toHaveBeenCalledWith(expect.objectContaining({
      cwd: mocked.prepareLocalCliRuntimeConfig.mock.calls[0]?.[0]?.cwd,
      config: expect.objectContaining({
        localCli: expect.objectContaining({ allowProjectConfig: false }),
      }),
    }));
  });

  it("fails when the local command is missing", async () => {
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureCommandResolvable.mockRejectedValue(new Error("Command not found: opencode"));

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_local_cli_command_missing", level: "error" }),
    ]));
    expect(mocked.discoverLocalCliOpenCodeModels).not.toHaveBeenCalled();
  });

  it("fails when the configured model is unavailable", async () => {
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-4.1", label: "openai/gpt-4.1" }]);
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockRejectedValue(new Error("Configured OpenCode model is unavailable: openai/gpt-5.4"));

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_local_cli_model_invalid", level: "error" }),
    ]));
  });
});

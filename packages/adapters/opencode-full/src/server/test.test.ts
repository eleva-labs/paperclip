import { afterEach, describe, expect, it, vi } from "vitest";

const ensureCommandResolvable = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);
const discoverLocalCliOpenCodeModels = vi.fn();
const ensureLocalCliOpenCodeModelConfiguredAndAvailable = vi.fn();
const prepareLocalCliRuntimeConfig = vi.fn();

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    ensurePathInEnv,
  };
});

vi.mock("./models.js", () => ({
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
}));

import { testLocalCliEnvironment } from "./test.js";

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

describe("opencode_full local_cli testEnvironment", () => {
  afterEach(() => {
    ensureCommandResolvable.mockReset();
    ensurePathInEnv.mockClear();
    discoverLocalCliOpenCodeModels.mockReset();
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
    prepareLocalCliRuntimeConfig.mockReset();
  });

  it("reports command present and configured model valid without claiming workspace readiness", async () => {
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: { FROM_RUNTIME_CONFIG: "1" }, notes: [], cleanup: vi.fn(async () => {}) });
    ensureCommandResolvable.mockResolvedValue(undefined);
    discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_full_config_valid", level: "info" }),
      expect.objectContaining({ code: "opencode_local_cli_command_found", level: "info" }),
      expect.objectContaining({ code: "opencode_local_cli_model_valid", level: "info" }),
    ]));
    expect(result.checks[0]?.detail).toMatch(/does not claim workspace-aware runtime readiness/i);
  });

  it("fails when the local command is missing", async () => {
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    ensureCommandResolvable.mockRejectedValue(new Error("Command not found: opencode"));

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_local_cli_command_missing", level: "error" }),
    ]));
    expect(discoverLocalCliOpenCodeModels).not.toHaveBeenCalled();
  });

  it("fails when the configured model is unavailable", async () => {
    prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, notes: [], cleanup: vi.fn(async () => {}) });
    ensureCommandResolvable.mockResolvedValue(undefined);
    discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-4.1", label: "openai/gpt-4.1" }]);
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockRejectedValue(new Error("Configured OpenCode model is unavailable: openai/gpt-5.4"));

    const result = await testLocalCliEnvironment({ adapterType: "opencode_full", config: localCliConfig } as never, localCliConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_local_cli_model_invalid", level: "error" }),
    ]));
  });
});

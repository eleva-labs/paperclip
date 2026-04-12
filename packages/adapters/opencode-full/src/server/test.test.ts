import { afterEach, describe, expect, it, vi } from "vitest";

const ensureCommandResolvable = vi.fn();
const ensurePathInEnv = vi.fn((env: Record<string, string>) => env);
const checkRemoteServerHealth = vi.fn();
const discoverLocalCliOpenCodeModels = vi.fn();
const discoverRemoteServerOpenCodeModels = vi.fn();
const ensureLocalCliOpenCodeModelConfiguredAndAvailable = vi.fn();
const ensureRemoteServerOpenCodeModelConfiguredAndAvailable = vi.fn();
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
  checkRemoteServerHealth,
  discoverLocalCliOpenCodeModels,
  discoverRemoteServerOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
}));

import { testLocalCliEnvironment, testRemoteServerEnvironment } from "./test.js";

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

const remoteServerConfig = {
  executionMode: "remote_server" as const,
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "bearer", token: "resolved-token" },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const, requireDedicatedServer: false },
  },
};

describe("opencode_full local_cli testEnvironment", () => {
  afterEach(() => {
    ensureCommandResolvable.mockReset();
    ensurePathInEnv.mockClear();
    discoverLocalCliOpenCodeModels.mockReset();
    checkRemoteServerHealth.mockReset();
    discoverRemoteServerOpenCodeModels.mockReset();
    ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockReset();
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

  it("reports reachable/authenticated remote_server health and model validation config-only", async () => {
    checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_server_reachable", level: "info" }),
      expect.objectContaining({ code: "opencode_remote_models_discovered", level: "info" }),
      expect.objectContaining({ code: "opencode_remote_model_valid", level: "info" }),
    ]));
    expect(result.checks[0]?.detail).toMatch(/does not claim workspace-aware runtime readiness/i);
  });

  it("fails remote_server testEnvironment on unreachable server", async () => {
    checkRemoteServerHealth.mockResolvedValue({
      ok: false,
      failureKind: "unreachable",
      status: 0,
      message: "Remote server health check could not reach https://opencode.example.com.",
      detail: "connect ECONNREFUSED",
    });

    const result = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_server_unreachable", level: "error" }),
    ]));
    expect(discoverRemoteServerOpenCodeModels).not.toHaveBeenCalled();
  });

  it("reports unresolved remote auth material truthfully", async () => {
    checkRemoteServerHealth.mockResolvedValue({
      ok: false,
      failureKind: "auth_unresolved",
      status: 0,
      message: "Remote auth must be runtime-resolved before it reaches opencode_full remote_server execution/testing.",
    });

    const result = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_auth_unresolved", level: "error" }),
    ]));
    expect(discoverRemoteServerOpenCodeModels).not.toHaveBeenCalled();
  });

  it("reports rejected auth and unhealthy remote server distinctly", async () => {
    checkRemoteServerHealth.mockResolvedValueOnce({
      ok: false,
      failureKind: "auth_rejected",
      status: 401,
      message: "Remote server rejected authentication (401).",
      detail: "unauthorized",
    });

    const authRejected = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);
    expect(authRejected.status).toBe("fail");
    expect(authRejected.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_auth_rejected", level: "error" }),
    ]));

    checkRemoteServerHealth.mockResolvedValueOnce({
      ok: false,
      failureKind: "unhealthy",
      status: 503,
      message: "Remote server health check failed (503).",
      detail: "degraded",
    });

    const unhealthy = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);
    expect(unhealthy.status).toBe("fail");
    expect(unhealthy.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_server_unhealthy", level: "error" }),
    ]));
  });

  it("fails remote_server testEnvironment on rejected auth or invalid configured model", async () => {
    checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    discoverRemoteServerOpenCodeModels.mockRejectedValue(new Error("Remote server rejected authentication (401) during model discovery."));

    const authRejected = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);
    expect(authRejected.status).toBe("fail");
    expect(authRejected.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_auth_rejected", level: "error" }),
    ]));

    discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-4.1", label: "openai/gpt-4.1" }]);
    ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockRejectedValue(new Error("Configured remote OpenCode model is unavailable: openai/gpt-5.4"));

    const invalidModel = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);
    expect(invalidModel.status).toBe("fail");
    expect(invalidModel.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_model_invalid", level: "error" }),
    ]));
  });

  it("records deferred target modes truthfully instead of approximating them", async () => {
    const result = await testRemoteServerEnvironment(
      { adapterType: "opencode_full", config: remoteServerConfig } as never,
      {
        ...remoteServerConfig,
        remoteServer: {
          ...remoteServerConfig.remoteServer,
          projectTarget: { mode: "paperclip_workspace", requireDedicatedServer: false },
        },
      } as never,
    );

    expect(result.status).toBe("warn");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_target_not_proven", level: "warn" }),
    ]));
    expect(checkRemoteServerHealth).not.toHaveBeenCalled();
  });
});

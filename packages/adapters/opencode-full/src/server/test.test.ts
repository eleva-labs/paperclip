import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./config-schema.js";

const mocked = vi.hoisted(() => ({
  ensureCommandResolvable: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
  checkRemoteServerHealth: vi.fn(),
  discoverLocalCliOpenCodeModels: vi.fn(),
  discoverRemoteServerOpenCodeModels: vi.fn(),
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: vi.fn(),
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: vi.fn(),
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

vi.mock("./models.js", () => ({
  checkRemoteServerHealth: mocked.checkRemoteServerHealth,
  discoverLocalCliOpenCodeModels: mocked.discoverLocalCliOpenCodeModels,
  discoverRemoteServerOpenCodeModels: mocked.discoverRemoteServerOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig: mocked.prepareLocalCliRuntimeConfig,
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

const remoteServerConfig: OpencodeFullRemoteServerRuntimeConfig = {
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
    mocked.ensureCommandResolvable.mockReset();
    mocked.ensurePathInEnv.mockClear();
    mocked.discoverLocalCliOpenCodeModels.mockReset();
    mocked.checkRemoteServerHealth.mockReset();
    mocked.discoverRemoteServerOpenCodeModels.mockReset();
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockReset();
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockReset();
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

  it("reports reachable/authenticated remote_server health and model validation config-only", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    mocked.discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

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
    mocked.checkRemoteServerHealth.mockResolvedValue({
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
    expect(mocked.discoverRemoteServerOpenCodeModels).not.toHaveBeenCalled();
  });

  it("reports unresolved remote auth material truthfully", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({
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
    expect(mocked.discoverRemoteServerOpenCodeModels).not.toHaveBeenCalled();
  });

  it("reports rejected auth and unhealthy remote server distinctly", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValueOnce({
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

    mocked.checkRemoteServerHealth.mockResolvedValueOnce({
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
    mocked.checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    mocked.discoverRemoteServerOpenCodeModels.mockRejectedValue(new Error("Remote server rejected authentication (401) during model discovery."));

    const authRejected = await testRemoteServerEnvironment({ adapterType: "opencode_full", config: remoteServerConfig } as never, remoteServerConfig);
    expect(authRejected.status).toBe("fail");
    expect(authRejected.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_auth_rejected", level: "error" }),
    ]));

    mocked.discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-4.1", label: "openai/gpt-4.1" }]);
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockRejectedValue(new Error("Configured remote OpenCode model is unavailable: openai/gpt-5.4"));

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
    expect(mocked.checkRemoteServerHealth).not.toHaveBeenCalled();
  });

  it("fails unsupported shared fixed_path targeting clearly instead of degrading", async () => {
    const result = await testRemoteServerEnvironment(
      { adapterType: "opencode_full", config: remoteServerConfig } as never,
      {
        ...remoteServerConfig,
        remoteServer: {
          ...remoteServerConfig.remoteServer,
          projectTarget: { mode: "fixed_path", projectPath: "/srv/shared/company-a", requireDedicatedServer: false },
        },
      } as never,
    );

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_target_not_proven", level: "error" }),
    ]));
    expect(mocked.checkRemoteServerHealth).not.toHaveBeenCalled();
  });
});

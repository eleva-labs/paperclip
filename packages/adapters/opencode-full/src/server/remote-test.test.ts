import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  checkRemoteServerHealth: vi.fn(),
  discoverRemoteServerOpenCodeModels: vi.fn(),
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: vi.fn(),
}));

vi.mock("./models.js", () => ({
  checkRemoteServerHealth: mocked.checkRemoteServerHealth,
}));

vi.mock("./remote-models.js", () => ({
  discoverRemoteServerOpenCodeModels: mocked.discoverRemoteServerOpenCodeModels,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
}));

import { testRemoteServerEnvironment } from "./remote-test.js";

const config = {
  executionMode: "remote_server" as const,
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "none" as const },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const },
  },
};

describe("opencode_full remote testEnvironment", () => {
  afterEach(() => {
    mocked.checkRemoteServerHealth.mockReset();
    mocked.discoverRemoteServerOpenCodeModels.mockReset();
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockReset();
  });

  it("passes the auth.mode=none happy path", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    mocked.discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testRemoteServerEnvironment({ config } as never, config as never);
    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_server_reachable" }),
      expect.objectContaining({ code: "opencode_remote_model_valid" }),
    ]));
  });

  it("rejects unresolved or non-none auth paths", async () => {
    const unresolved = await testRemoteServerEnvironment({ config } as never, {
      ...config,
      remoteServer: {
        ...config.remoteServer,
        auth: { mode: "bearer", token: "resolved-token" },
      },
    } as never);
    expect(unresolved.status).toBe("fail");
    expect(unresolved.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_auth_unresolved" }),
    ]));
  });

  it("reports health failures distinctly", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({ ok: false, failureKind: "unreachable", status: 0, message: "unreachable" });
    const result = await testRemoteServerEnvironment({ config } as never, config as never);
    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "opencode_remote_server_unreachable" }),
    ]));
  });
});

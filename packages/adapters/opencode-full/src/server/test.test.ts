import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  testLocalCliEnvironment: vi.fn(),
  testRemoteServerEnvironment: vi.fn(),
}));

vi.mock("./local-test.js", () => ({
  testLocalCliEnvironment: mocked.testLocalCliEnvironment,
}));

vi.mock("./remote-test.js", () => ({
  testRemoteServerEnvironment: mocked.testRemoteServerEnvironment,
}));

import { testEnvironment } from "./test.js";

describe("opencode_full testEnvironment dispatcher", () => {
  afterEach(() => {
    mocked.testLocalCliEnvironment.mockReset();
    mocked.testRemoteServerEnvironment.mockReset();
  });

  it("dispatches local mode", async () => {
    mocked.testLocalCliEnvironment.mockResolvedValue({ adapterType: "opencode_full", status: "pass", testedAt: "now", checks: [] });
    const result = await testEnvironment({ config: {
      executionMode: "local_cli",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      localCli: { command: "opencode", allowProjectConfig: true, dangerouslySkipPermissions: false, graceSec: 5, env: {} },
    } } as never);
    expect(result.status).toBe("pass");
    expect(mocked.testLocalCliEnvironment).toHaveBeenCalledOnce();
  });

  it("dispatches remote mode", async () => {
    mocked.testRemoteServerEnvironment.mockResolvedValue({ adapterType: "opencode_full", status: "pass", testedAt: "now", checks: [] });
    const result = await testEnvironment({ config: {
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: { baseUrl: "https://opencode.example.com", auth: { mode: "none" }, healthTimeoutSec: 10, requireHealthyServer: true, projectTarget: { mode: "server_default" } },
    } } as never);
    expect(result.status).toBe("pass");
    expect(mocked.testRemoteServerEnvironment).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

const mocked = vi.hoisted(() => ({
  executeLocalCli: vi.fn(),
  executeRemoteServer: vi.fn(),
}));

vi.mock("./local-execute.js", () => ({
  executeLocalCli: mocked.executeLocalCli,
}));

vi.mock("./remote-execute.js", () => ({
  executeRemoteServer: mocked.executeRemoteServer,
}));

import { execute } from "./execute.js";

const local = {
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

const remote = {
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

function ctx(config: unknown): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", name: "Agent 1", companyId: "company-1" },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: {},
    onLog: vi.fn(async () => {}),
    onMeta: vi.fn(async () => {}),
    onSpawn: vi.fn(async () => {}),
    authToken: null,
  } as never;
}

describe("opencode_full execute dispatcher", () => {
  afterEach(() => {
    mocked.executeLocalCli.mockReset();
    mocked.executeRemoteServer.mockReset();
  });

  it("dispatches local_cli to local runtime", async () => {
    mocked.executeLocalCli.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "ok" });
    const result = await execute(ctx(local));
    expect(mocked.executeLocalCli).toHaveBeenCalledOnce();
    expect(mocked.executeRemoteServer).not.toHaveBeenCalled();
    expect(result.summary).toBe("ok");
  });

  it("dispatches remote_server to remote runtime", async () => {
    mocked.executeRemoteServer.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, summary: "remote" });
    const result = await execute(ctx(remote));
    expect(mocked.executeRemoteServer).toHaveBeenCalledOnce();
    expect(mocked.executeLocalCli).not.toHaveBeenCalled();
    expect(result.summary).toBe("remote");
  });

  it("fails invalid config through normalized schema error", async () => {
    const result = await execute(ctx({ executionMode: "remote_server" }));
    expect(result).toMatchObject({ exitCode: 1, errorCode: "CONFIG_INVALID" });
  });
});

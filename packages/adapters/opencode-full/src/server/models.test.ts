import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  runChildProcess: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
  listLocalCliOpenCodeModels: vi.fn(),
  discoverRemoteServerOpenCodeModels: vi.fn(),
  checkRemoteServerHealth: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensurePathInEnv: mocked.ensurePathInEnv,
    runChildProcess: mocked.runChildProcess,
  };
});

vi.mock("./local-models.js", async () => {
  const actual = await vi.importActual<typeof import("./local-models.js")>("./local-models.js");
  return {
    ...actual,
    listLocalCliOpenCodeModels: mocked.listLocalCliOpenCodeModels,
  };
});

vi.mock("./remote-models.js", async () => {
  const actual = await vi.importActual<typeof import("./remote-models.js")>("./remote-models.js");
  return {
    ...actual,
    discoverRemoteServerOpenCodeModels: mocked.discoverRemoteServerOpenCodeModels,
    checkRemoteServerHealth: mocked.checkRemoteServerHealth,
  };
});

import {
  listModels,
  prepareLocalCliRuntimeConfig,
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  checkRemoteServerHealth,
  remoteServerExecutionScope,
} from "./models.js";

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
    dangerouslySkipPermissions: true,
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
    auth: { mode: "none" as const },
    healthTimeoutSec: 5,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const },
  },
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-full-"));
  tempDirs.push(dir);
  return dir;
}

describe("opencode_full model dispatcher", () => {
  afterEach(() => {
    mocked.runChildProcess.mockReset();
    mocked.ensurePathInEnv.mockClear();
    mocked.listLocalCliOpenCodeModels.mockReset();
    mocked.discoverRemoteServerOpenCodeModels.mockReset();
    mocked.checkRemoteServerHealth.mockReset();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prepares staged runtime config while preserving local project config by default", async () => {
    const xdgHome = makeTempDir();
    fs.mkdirSync(path.join(xdgHome, "opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(xdgHome, "opencode", "opencode.json"),
      JSON.stringify({ permission: { shell: "ask" }, model: "openai/gpt-5.4" }, null, 2),
    );

    const prepared = await prepareLocalCliRuntimeConfig({
      env: { XDG_CONFIG_HOME: xdgHome },
      config: localCliConfig,
      cwd: "/repo/worktree",
    });

    try {
      expect(prepared.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined();
      expect(prepared.env.XDG_CONFIG_HOME).not.toBe(xdgHome);
    } finally {
      await prepared.cleanup();
    }
  });

  it("parses discovered local models and rejects invalid configured model", async () => {
    mocked.runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 0,
      stdout: ["anthropic/claude-3-7-sonnet", "openai/gpt-5.4", "openai/gpt-4.1"].join("\n"),
      stderr: "",
    });

    await expect(discoverLocalCliOpenCodeModels({ command: "opencode", cwd: "/repo/worktree", env: {}, config: localCliConfig })).resolves.toEqual([
      { id: "anthropic/claude-3-7-sonnet", label: "anthropic/claude-3-7-sonnet" },
      { id: "openai/gpt-4.1", label: "openai/gpt-4.1" },
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);

    mocked.runChildProcess.mockResolvedValue({ timedOut: false, exitCode: 0, stdout: "openai/gpt-4.1", stderr: "" });
    await expect(ensureLocalCliOpenCodeModelConfiguredAndAvailable({ model: "openai/gpt-5.4", cwd: "/repo/worktree", config: localCliConfig })).rejects.toThrow(/Configured OpenCode model is unavailable/);
  });

  it("classifies remote health and scope helpers", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({ ok: true, status: 200, message: "Remote server health check succeeded." });
    await expect(checkRemoteServerHealth(remoteServerConfig as never)).resolves.toMatchObject({ ok: true, status: 200 });
    expect(remoteServerExecutionScope(remoteServerConfig as never)).toBe("server_default_only");
  });

  it("lists local models by default", async () => {
    mocked.listLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    await expect(listModels()).resolves.toEqual([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
  });

  it("dispatches remote configs to remote model discovery", async () => {
    mocked.discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    await expect(listModels({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    })).resolves.toEqual([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
  });
});

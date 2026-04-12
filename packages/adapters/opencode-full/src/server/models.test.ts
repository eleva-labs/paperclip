import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import {
  checkRemoteServerHealth,
  discoverLocalCliOpenCodeModels,
  discoverRemoteServerOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
  resetLocalCliOpenCodeModelsCacheForTests,
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
    auth: { mode: "bearer" as const, token: "resolved-token" },
    healthTimeoutSec: 5,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const, requireDedicatedServer: false },
  },
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-full-"));
  tempDirs.push(dir);
  return dir;
}

describe("opencode_full local_cli models/runtime config", () => {
  afterEach(() => {
    runChildProcess.mockReset();
    ensurePathInEnv.mockClear();
    resetLocalCliOpenCodeModelsCacheForTests();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllGlobals();
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
      expect(prepared.notes).toEqual(expect.arrayContaining([
        "Repo-local OpenCode project config remains enabled for cwd /repo/worktree.",
        expect.stringContaining("permission.external_directory=allow"),
      ]));

      const runtimeConfig = JSON.parse(
        fs.readFileSync(path.join(prepared.env.XDG_CONFIG_HOME, "opencode", "opencode.json"), "utf8"),
      ) as { permission?: Record<string, string>; model?: string };
      expect(runtimeConfig.model).toBe("openai/gpt-5.4");
      expect(runtimeConfig.permission).toMatchObject({
        shell: "ask",
        external_directory: "allow",
      });
    } finally {
      await prepared.cleanup();
    }
  });

  it("parses, dedupes, and sorts discovered models", async () => {
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

    const models = await discoverLocalCliOpenCodeModels({
      command: "custom-opencode",
      cwd: "/repo/worktree",
      env: { CUSTOM_ENV: "yes" },
      config: localCliConfig,
    });

    expect(models).toEqual([
      { id: "anthropic/claude-3-7-sonnet", label: "anthropic/claude-3-7-sonnet" },
      { id: "openai/gpt-4.1", label: "openai/gpt-4.1" },
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
    expect(runChildProcess).toHaveBeenCalledWith(
      expect.stringMatching(/^opencode-full-models-/),
      "custom-opencode",
      ["models"],
      expect.objectContaining({
        cwd: "/repo/worktree",
        env: expect.objectContaining({ CUSTOM_ENV: "yes" }),
      }),
    );
  });

  it("rejects an unavailable configured model", async () => {
    runChildProcess.mockResolvedValue({
      timedOut: false,
      exitCode: 0,
      stdout: ["openai/gpt-4.1", "anthropic/claude-3-7-sonnet"].join("\n"),
      stderr: "",
    });

    await expect(
      ensureLocalCliOpenCodeModelConfiguredAndAvailable({
        model: "openai/gpt-5.4",
        cwd: "/repo/canonical",
        config: localCliConfig,
      }),
    ).rejects.toThrow(/Configured OpenCode model is unavailable: openai\/gpt-5\.4/);
  });

  it("checks remote health with resolved credentials only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "ok" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkRemoteServerHealth(remoteServerConfig);

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.example.com/health",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer resolved-token" }),
      }),
    );
  });

  it("classifies unresolved auth, rejected auth, unhealthy server, and unreachable transport distinctly", async () => {
    const unresolved = await checkRemoteServerHealth({
      ...remoteServerConfig,
      remoteServer: {
        ...remoteServerConfig.remoteServer,
        auth: { mode: "bearer", token: { secretRef: "paperclip:secret:remote-token" } } as never,
      },
    });
    expect(unresolved).toMatchObject({ ok: false, failureKind: "auth_unresolved", status: 0 });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "degraded",
      })
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkRemoteServerHealth(remoteServerConfig)).resolves.toMatchObject({
      ok: false,
      failureKind: "auth_rejected",
      status: 401,
    });
    await expect(checkRemoteServerHealth(remoteServerConfig)).resolves.toMatchObject({
      ok: false,
      failureKind: "unhealthy",
      status: 503,
    });
    await expect(checkRemoteServerHealth(remoteServerConfig)).resolves.toMatchObject({
      ok: false,
      failureKind: "unreachable",
      status: 0,
    });
  });

  it("discovers and validates remote models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ models: [{ id: "openai/gpt-5.4" }, "openai/gpt-4.1"] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverRemoteServerOpenCodeModels(remoteServerConfig)).resolves.toEqual([
      { id: "openai/gpt-4.1", label: "openai/gpt-4.1" },
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
    await expect(ensureRemoteServerOpenCodeModelConfiguredAndAvailable(remoteServerConfig)).resolves.toEqual(expect.any(Array));
  });

  it("fails remote model discovery cleanly on auth rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverRemoteServerOpenCodeModels(remoteServerConfig)).rejects.toThrow(/rejected authentication/i);
  });
});

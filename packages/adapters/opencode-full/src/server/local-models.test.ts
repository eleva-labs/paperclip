import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  runChildProcess: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
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

import {
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
  resetLocalCliOpenCodeModelsCacheForTests,
} from "./local-models.js";

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

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-full-"));
  tempDirs.push(dir);
  return dir;
}

describe("opencode_full local_cli local-models", () => {
  afterEach(() => {
    mocked.runChildProcess.mockReset();
    mocked.ensurePathInEnv.mockClear();
    resetLocalCliOpenCodeModelsCacheForTests();
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
    mocked.runChildProcess.mockResolvedValue({
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
  });

  it("rejects an unavailable configured model", async () => {
    mocked.runChildProcess.mockResolvedValue({
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
});

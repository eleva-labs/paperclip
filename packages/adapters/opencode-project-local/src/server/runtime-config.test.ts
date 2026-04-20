import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareProjectAwareOpenCodeRuntimeConfig } from "./runtime-config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-project-local-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("prepareProjectAwareOpenCodeRuntimeConfig", () => {
  it("keeps project config enabled by default and injects headless permissions config", async () => {
    const xdgHome = makeTempDir();
    const cwd = makeTempDir();
    fs.mkdirSync(path.join(xdgHome, "opencode"), { recursive: true });
    fs.writeFileSync(
      path.join(xdgHome, "opencode", "opencode.json"),
      JSON.stringify({ permission: { shell: "ask" }, model: "openai/gpt-5.4" }, null, 2),
    );

    const prepared = await prepareProjectAwareOpenCodeRuntimeConfig({
      cwd,
      config: {},
      env: { XDG_CONFIG_HOME: xdgHome },
    });

    try {
      expect(prepared.env.XDG_CONFIG_HOME).not.toBe(xdgHome);
      expect(prepared.notes).toEqual(expect.arrayContaining([
        `Repo-local OpenCode project config remains enabled for cwd ${cwd}.`,
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

  it("disables project config unless env explicitly overrides it", async () => {
    const cwd = makeTempDir();

    const disabled = await prepareProjectAwareOpenCodeRuntimeConfig({
      cwd,
      config: { allowProjectConfig: false, dangerouslySkipPermissions: false },
      env: {},
    });
    try {
      expect(disabled.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("true");
      expect(disabled.notes).toContain(
        "Disabled repo-local OpenCode project config because allowProjectConfig=false.",
      );
    } finally {
      await disabled.cleanup();
    }

    const preserved = await prepareProjectAwareOpenCodeRuntimeConfig({
      cwd,
      config: { allowProjectConfig: false, dangerouslySkipPermissions: false },
      env: { OPENCODE_DISABLE_PROJECT_CONFIG: "false" },
    });
    try {
      expect(preserved.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe("false");
      expect(preserved.notes).toContain(
        'Preserved explicit OPENCODE_DISABLE_PROJECT_CONFIG="false" override.',
      );
    } finally {
      await preserved.cleanup();
    }
  });
});

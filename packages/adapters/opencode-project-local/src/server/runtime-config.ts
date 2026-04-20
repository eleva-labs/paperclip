import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asBoolean } from "@paperclipai/adapter-utils/server-utils";

export type PreparedProjectAwareOpenCodeRuntimeConfig = {
  env: Record<string, string>;
  notes: string[];
  cleanup: () => Promise<void>;
};

function resolveXdgConfigHome(env: Record<string, string>): string {
  return (
    (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()) ||
    (typeof process.env.XDG_CONFIG_HOME === "string" && process.env.XDG_CONFIG_HOME.trim()) ||
    path.join(os.homedir(), ".config")
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(filepath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function prepareProjectAwareOpenCodeRuntimeConfig(input: {
  env: Record<string, string>;
  config: Record<string, unknown>;
  cwd: string;
}): Promise<PreparedProjectAwareOpenCodeRuntimeConfig> {
  const allowProjectConfig = asBoolean(input.config.allowProjectConfig, true);
  const skipPermissions = asBoolean(input.config.dangerouslySkipPermissions, true);
  const notes: string[] = [];
  const nextEnv: Record<string, string> = { ...input.env };

  if (!allowProjectConfig) {
    if (!("OPENCODE_DISABLE_PROJECT_CONFIG" in nextEnv)) {
      nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
      notes.push("Disabled repo-local OpenCode project config because allowProjectConfig=false.");
    } else {
      notes.push(
        `Preserved explicit OPENCODE_DISABLE_PROJECT_CONFIG=${JSON.stringify(nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG)} override.`,
      );
    }
  } else if ("OPENCODE_DISABLE_PROJECT_CONFIG" in nextEnv) {
    notes.push(
      `Preserved explicit OPENCODE_DISABLE_PROJECT_CONFIG=${JSON.stringify(nextEnv.OPENCODE_DISABLE_PROJECT_CONFIG)} override while allowProjectConfig=true.`,
    );
  } else {
    notes.push(`Repo-local OpenCode project config remains enabled for cwd ${input.cwd}.`);
  }

  if (!skipPermissions) {
    return {
      env: nextEnv,
      notes,
      cleanup: async () => {},
    };
  }

  const sourceConfigDir = path.join(resolveXdgConfigHome(nextEnv), "opencode");
  const runtimeConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-opencode-project-config-"));
  const runtimeConfigDir = path.join(runtimeConfigHome, "opencode");
  const runtimeConfigPath = path.join(runtimeConfigDir, "opencode.json");

  await fs.mkdir(runtimeConfigDir, { recursive: true });
  try {
    await fs.cp(sourceConfigDir, runtimeConfigDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
      dereference: false,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
  }

  const existingConfig = await readJsonObject(runtimeConfigPath);
  const existingPermission = isPlainObject(existingConfig.permission) ? existingConfig.permission : {};
  const nextConfig = {
    ...existingConfig,
    permission: {
      ...existingPermission,
      external_directory: "allow",
    },
  };
  await fs.writeFile(runtimeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");

  return {
    env: {
      ...nextEnv,
      XDG_CONFIG_HOME: runtimeConfigHome,
    },
    notes: [
      ...notes,
      "Injected runtime OpenCode config with permission.external_directory=allow to avoid headless approval prompts.",
    ],
    cleanup: async () => {
      await fs.rm(runtimeConfigHome, { recursive: true, force: true });
    },
  };
}

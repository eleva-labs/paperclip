import { describe, expect, it } from "vitest";
import {
  getOpencodeProjectLocalConfigSchema,
  opencodeProjectLocalConfigSchema,
} from "./config-schema.js";

describe("opencodeProjectLocalConfigSchema", () => {
  it("accepts valid config and applies defaults", () => {
    const parsed = opencodeProjectLocalConfigSchema.parse({
      model: "openai/gpt-5.4",
    });

    expect(parsed).toMatchObject({
      command: "opencode",
      model: "openai/gpt-5.4",
      extraArgs: [],
      env: {},
      dangerouslySkipPermissions: true,
      allowProjectConfig: true,
      canonicalWorkspaceOnly: false,
      syncPluginKey: "paperclip-opencode-project",
    });
  });

  it("rejects malformed adapter config", () => {
    const result = opencodeProjectLocalConfigSchema.safeParse({
      model: "   ",
      extraArgs: ["ok", ""],
      env: { PAPERCLIP_API_KEY: 123 },
      timeoutSec: 0,
      graceSec: -1,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const issues = result.error.issues.map((issue: { path: Array<string | number> }) => issue.path.join("."));
    expect(issues).toEqual(
      expect.arrayContaining(["model", "extraArgs.1", "env.PAPERCLIP_API_KEY", "timeoutSec", "graceSec"]),
    );
  });

  it("exposes the external adapter config fields expected by the host", () => {
    const schema = getOpencodeProjectLocalConfigSchema();
    const fieldKeys = schema.fields.map((field: { key: string }) => field.key);

    expect(fieldKeys).toEqual([
      "command",
      "model",
      "variant",
      "cwd",
      "instructionsFilePath",
      "extraArgs",
      "env",
      "promptTemplate",
      "bootstrapPromptTemplate",
      "dangerouslySkipPermissions",
      "allowProjectConfig",
      "canonicalWorkspaceOnly",
      "syncPluginKey",
      "timeoutSec",
      "graceSec",
    ]);
  });
});

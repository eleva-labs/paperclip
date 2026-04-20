import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import type { ZodIssue } from "zod";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";
import { testLocalCliEnvironment } from "./local-test.js";
import { testRemoteServerEnvironment } from "./remote-test.js";

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const parsed = opencodeFullRuntimeConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    return {
      adapterType: "opencode_full",
      status: "fail",
      testedAt: new Date().toISOString(),
      checks: [{
        code: "opencode_full_config_invalid",
        level: "error",
        message: "Config-only environment check failed schema validation.",
        detail: parsed.error.issues.map((issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      }],
    };
  }

  if (parsed.data.executionMode === "local_cli") {
    return testLocalCliEnvironment(ctx, parsed.data);
  }
  if (parsed.data.executionMode === "remote_server") {
    return testRemoteServerEnvironment(ctx, parsed.data);
  }

  return {
    adapterType: "opencode_full",
    status: "warn",
    testedAt: new Date().toISOString(),
    checks: [{
      code: "opencode_local_sdk_unavailable",
      level: "warn",
      message: "local_sdk is a deferred schema branch only and is not executable yet.",
      detail: "testEnvironment() currently stays config-only and defers runtime validation.",
    }],
  };
}

export { testLocalCliEnvironment } from "./local-test.js";
export { testRemoteServerEnvironment } from "./remote-test.js";

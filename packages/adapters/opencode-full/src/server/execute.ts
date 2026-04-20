import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { ZodIssue } from "zod";
import { parseOpencodeFullExecutionResult } from "./result-schema.js";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";
import { executeLocalCli } from "./local-execute.js";
import { executeRemoteServer } from "./remote-execute.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const parsed = opencodeFullRuntimeConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    return parseOpencodeFullExecutionResult({
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "CONFIG_INVALID",
      errorMessage: "Execution config failed schema validation.",
      errorMeta: {
        issues: parsed.error.issues.map((issue: ZodIssue) => `${issue.path.join(".")}: ${issue.message}`),
      },
      sessionParams: null,
      sessionDisplayId: null,
      summary: null,
    });
  }

  if (parsed.data.executionMode === "local_cli") {
    return parseOpencodeFullExecutionResult(await executeLocalCli(ctx, parsed.data));
  }
  if (parsed.data.executionMode === "remote_server") {
    return parseOpencodeFullExecutionResult(await executeRemoteServer(ctx, parsed.data));
  }

  return parseOpencodeFullExecutionResult({
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: "UNAVAILABLE",
    errorMessage: `opencode_full ${parsed.data.executionMode} execution is not available yet. This execution mode is not available in the current runtime; only the supported MVP execution paths are executable.`,
    sessionParams: null,
    sessionDisplayId: null,
    summary: null,
  });
}

export { executeLocalCli } from "./local-execute.js";
export { executeRemoteServer } from "./remote-execute.js";

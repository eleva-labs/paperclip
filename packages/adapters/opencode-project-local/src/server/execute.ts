import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { inferOpenAiCompatibleBiller } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  joinPromptSections,
  parseJson,
  parseObject,
  renderTemplate,
  renderPaperclipWakePrompt,
  resolveCommandForLogs,
  runChildProcess,
  stringifyPaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import { importedOpencodeAgentMetadataSchema } from "./metadata.js";
import { ensureProjectAwareOpenCodeModelConfiguredAndAvailable } from "./models.js";
import { prepareProjectAwareOpenCodeRuntimeConfig } from "./runtime-config.js";

export type ResolveProjectExecutionContextInput = {
  agent: { id: string; companyId: string };
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
};

export type ResolveProjectExecutionContextResult = {
  cwd: string;
  canonicalWorkspaceId: string | null;
  canonicalWorkspaceCwd: string | null;
  executionWorkspaceId: string | null;
  executionWorkspaceSource: "project_primary" | "git_worktree" | "adapter_fallback";
  allowProjectConfig: boolean;
  repoUrl: string | null;
  repoRef: string | null;
  warnings: string[];
};

type ParsedJsonlResult = {
  sessionId: string | null;
  summary: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  costUsd: number;
  errorMessage: string | null;
};

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function parseModelProvider(model: string | null): string | null {
  if (!model) return null;
  const trimmed = model.trim();
  if (!trimmed.includes("/")) return null;
  return trimmed.slice(0, trimmed.indexOf("/")).trim() || null;
}

function resolveOpenCodeBiller(env: Record<string, string>, provider: string | null): string {
  return inferOpenAiCompatibleBiller(env, null) ?? provider ?? "unknown";
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = parseObject(value);
  const message = asString(record.message, "").trim();
  if (message) return message;
  const data = parseObject(record.data);
  const nestedMessage = asString(data.message, "").trim();
  if (nestedMessage) return nestedMessage;
  const name = asString(record.name, "").trim();
  if (name) return name;
  const code = asString(record.code, "").trim();
  if (code) return code;
  try {
    return JSON.stringify(record);
  } catch {
    return "";
  }
}

function parseOpenCodeJsonl(stdout: string): ParsedJsonlResult {
  let sessionId: string | null = null;
  const messages: string[] = [];
  const errors: string[] = [];
  const usage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  let costUsd = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = parseJson(line);
    if (!event) continue;

    const currentSessionId = asString(event.sessionID, "").trim();
    if (currentSessionId) sessionId = currentSessionId;

    const type = asString(event.type, "");
    if (type === "text") {
      const part = parseObject(event.part);
      const text = asString(part.text, "").trim();
      if (text) messages.push(text);
      continue;
    }
    if (type === "step_finish") {
      const part = parseObject(event.part);
      const tokens = parseObject(part.tokens);
      const cache = parseObject(tokens.cache);
      usage.inputTokens += asNumber(tokens.input, 0);
      usage.cachedInputTokens += asNumber(cache.read, 0);
      usage.outputTokens += asNumber(tokens.output, 0) + asNumber(tokens.reasoning, 0);
      costUsd += asNumber(part.cost, 0);
      continue;
    }
    if (type === "tool_use") {
      const part = parseObject(event.part);
      const state = parseObject(part.state);
      if (asString(state.status, "") === "error") {
        const text = asString(state.error, "").trim();
        if (text) errors.push(text);
      }
      continue;
    }
    if (type === "error") {
      const text = errorText(event.error ?? event.message).trim();
      if (text) errors.push(text);
    }
  }

  return {
    sessionId,
    summary: messages.join("\n\n").trim(),
    usage,
    costUsd,
    errorMessage: errors.length > 0 ? errors.join("\n") : null,
  };
}

function isOpenCodeUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown\s+session|session\b.*\bnot\s+found|resource\s+not\s+found:.*[\\/]session[\\/].*\.json|notfounderror|no session/i.test(
    haystack,
  );
}

function readAgentMetadata(agent: AdapterExecutionContext["agent"]): Record<string, unknown> | null {
  const metadata = (agent as { metadata?: unknown }).metadata;
  const parsed = parseObject(metadata);
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function normalizePath(value: string | null): string | null {
  return value ? path.resolve(value) : null;
}

function describeWorkspaceDelta(canonicalWorkspaceCwd: string | null, cwd: string): string | null {
  const canonical = normalizePath(canonicalWorkspaceCwd);
  const execution = normalizePath(cwd);
  if (!canonical || !execution || canonical === execution) return null;
  return `Canonical project workspace is \"${canonical}\" but this run executes in \"${execution}\".`;
}

function describeCanonicalWorkspaceOverride(workspaceCwd: string, canonicalWorkspaceCwd: string): string | null {
  const resolvedWorkspace = normalizePath(workspaceCwd);
  const canonical = normalizePath(canonicalWorkspaceCwd);
  if (!resolvedWorkspace || !canonical || resolvedWorkspace === canonical) return null;
  return `Resolved execution workspace \"${resolvedWorkspace}\" was overridden to canonical project workspace \"${canonical}\" because canonicalWorkspaceOnly=true.`;
}

function resolveRuntimeWorkspaceEnv(input: {
  workspaceContext: Record<string, unknown>;
  executionContext: ResolveProjectExecutionContextResult;
  canonicalWorkspaceOnly: boolean;
}) {
  if (input.canonicalWorkspaceOnly) {
    return {
      cwd: input.executionContext.cwd,
      source: "project_primary",
      strategy: "project_primary",
    } as const;
  }

  return {
    cwd: asString(input.workspaceContext.cwd, "").trim() || input.executionContext.cwd,
    source: asString(input.workspaceContext.source, "").trim() || null,
    strategy: asString(input.workspaceContext.strategy, "").trim() || null,
  } as const;
}

export function resolveProjectExecutionContext(input: ResolveProjectExecutionContextInput): ResolveProjectExecutionContextResult {
  const config = input.config;
  const context = input.context;
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const metadataParse = importedOpencodeAgentMetadataSchema.safeParse(input.metadata ?? {});
  const importedMetadata = metadataParse.success ? metadataParse.data : null;

  const canonicalHint =
    (importedMetadata?.workspaceId
      ? workspaceHints.find((hint) => asString(hint.workspaceId, "").trim() === importedMetadata.workspaceId)
      : null) ?? null;

  const canonicalWorkspaceId = importedMetadata?.workspaceId ?? (asString(canonicalHint?.workspaceId, "").trim() || null);
  const canonicalWorkspaceCwd =
    asString(canonicalHint?.cwd, "").trim() || importedMetadata?.repoRoot || null;

  const workspaceCwd = asString(workspaceContext.cwd, "").trim();
  const workspaceSource = asString(workspaceContext.source, "").trim();
  const workspaceStrategy = asString(workspaceContext.strategy, "").trim();
  const executionWorkspaceId = asString(workspaceContext.workspaceId, "").trim() || null;
  const configuredCwd = asString(config.cwd, "").trim();
  const allowProjectConfig = config.allowProjectConfig !== false;

  const useExecutionWorkspace = workspaceCwd.length > 0 && !((workspaceSource === "agent_home" || workspaceSource === "task_session") && configuredCwd.length > 0);
  const executionWorkspaceSource = useExecutionWorkspace
    ? (workspaceStrategy === "git_worktree" || asString(workspaceContext.worktreePath, "").trim().length > 0
        ? "git_worktree"
        : "project_primary")
    : "adapter_fallback";

  if (config.canonicalWorkspaceOnly === true) {
    if (!canonicalWorkspaceCwd) {
      throw new Error(
        "Canonical workspace only is enabled, but canonical project workspace metadata/cwd is unavailable for this run.",
      );
    }

    const warnings = [describeCanonicalWorkspaceOverride(workspaceCwd, canonicalWorkspaceCwd)].filter(
      (value): value is string => Boolean(value),
    );

    return {
      cwd: canonicalWorkspaceCwd,
      canonicalWorkspaceId,
      canonicalWorkspaceCwd,
      executionWorkspaceId: canonicalWorkspaceId,
      executionWorkspaceSource: "project_primary",
      allowProjectConfig,
      repoUrl: asString(canonicalHint?.repoUrl, "").trim() || asString(workspaceContext.repoUrl, "").trim() || null,
      repoRef: asString(canonicalHint?.repoRef, "").trim() || asString(workspaceContext.repoRef, "").trim() || null,
      warnings,
    };
  }

  const cwd =
    useExecutionWorkspace
      ? workspaceCwd
      : canonicalWorkspaceCwd || configuredCwd || process.cwd();

  const repoUrl =
    asString(workspaceContext.repoUrl, "").trim() || asString(canonicalHint?.repoUrl, "").trim() || null;
  const repoRef =
    asString(workspaceContext.repoRef, "").trim() || asString(canonicalHint?.repoRef, "").trim() || null;
  const warnings = [describeWorkspaceDelta(canonicalWorkspaceCwd, cwd)].filter((value): value is string => Boolean(value));

  return {
    cwd,
    canonicalWorkspaceId,
    canonicalWorkspaceCwd,
    executionWorkspaceId,
    executionWorkspaceSource,
    allowProjectConfig,
    repoUrl,
    repoRef,
    warnings,
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const command = asString(config.command, "opencode");
  const model = asString(config.model, "").trim();
  const variant = asString(config.variant, "").trim();
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const executionContext = resolveProjectExecutionContext({
    agent,
    config,
    context,
    metadata: readAgentMetadata(agent),
  });
  const runtimeWorkspaceEnv = resolveRuntimeWorkspaceEnv({
    workspaceContext,
    executionContext,
    canonicalWorkspaceOnly: config.canonicalWorkspaceOnly === true,
  });
  const cwd = executionContext.cwd;
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
  if (runtimeWorkspaceEnv.cwd) env.PAPERCLIP_WORKSPACE_CWD = runtimeWorkspaceEnv.cwd;
  if (runtimeWorkspaceEnv.source) env.PAPERCLIP_WORKSPACE_SOURCE = runtimeWorkspaceEnv.source;
  if (runtimeWorkspaceEnv.strategy) env.PAPERCLIP_WORKSPACE_STRATEGY = runtimeWorkspaceEnv.strategy;
  if (executionContext.executionWorkspaceId) env.PAPERCLIP_WORKSPACE_ID = executionContext.executionWorkspaceId;
  if (executionContext.repoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = executionContext.repoUrl;
  if (executionContext.repoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = executionContext.repoRef;
  if (executionContext.canonicalWorkspaceId) env.PAPERCLIP_CANONICAL_WORKSPACE_ID = executionContext.canonicalWorkspaceId;
  if (executionContext.canonicalWorkspaceCwd) env.PAPERCLIP_CANONICAL_WORKSPACE_CWD = executionContext.canonicalWorkspaceCwd;
  env.PAPERCLIP_EXECUTION_WORKSPACE_SOURCE = executionContext.executionWorkspaceSource;
  if (Array.isArray(context.paperclipWorkspaces) && context.paperclipWorkspaces.length > 0) {
    env.PAPERCLIP_WORKSPACES_JSON = JSON.stringify(context.paperclipWorkspaces);
  }
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  if (!hasExplicitApiKey && authToken) env.PAPERCLIP_API_KEY = authToken;

  const preparedRuntimeConfig = await prepareProjectAwareOpenCodeRuntimeConfig({ env, config, cwd });
  try {
    const runtimeEnv = Object.fromEntries(
      Object.entries(ensurePathInEnv({ ...process.env, ...preparedRuntimeConfig.env })).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    await ensureCommandResolvable(command, cwd, runtimeEnv);
    const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
    const loggedEnv = buildInvocationEnvForLogs(preparedRuntimeConfig.env, {
      runtimeEnv,
      includeRuntimeKeys: ["HOME"],
      resolvedCommand,
    });

    await ensureProjectAwareOpenCodeModelConfiguredAndAvailable({
      model,
      command,
      cwd,
      env: runtimeEnv,
      config,
      runtimeMetadata: {
        canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
        canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
        executionWorkspaceId: executionContext.executionWorkspaceId,
        executionWorkspaceSource: executionContext.executionWorkspaceSource,
      },
    });

    for (const warning of executionContext.warnings) {
      await onLog("stdout", `[paperclip] Warning: ${warning}\n`);
    }

    const timeoutSec = asNumber(config.timeoutSec, 0);
    const graceSec = asNumber(config.graceSec, 20);
    const extraArgs = (() => {
      const fromExtraArgs = asStringArray(config.extraArgs);
      if (fromExtraArgs.length > 0) return fromExtraArgs;
      return asStringArray(config.args);
    })();

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      runtimeSessionCwd.length > 0 &&
      path.resolve(runtimeSessionCwd) === path.resolve(cwd);
    const sessionId = canResumeSession ? runtimeSessionId : null;
    if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Warning: OpenCode session \"${runtimeSessionId}\" was saved for cwd \"${runtimeSessionCwd || "unknown"}\" and will not be resumed in \"${cwd}\".\n`,
      );
    }

    const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
    const resolvedInstructionsFilePath = instructionsFilePath ? path.resolve(cwd, instructionsFilePath) : "";
    const instructionsDir = resolvedInstructionsFilePath ? `${path.dirname(resolvedInstructionsFilePath)}/` : "";
    let instructionsPrefix = "";
    if (resolvedInstructionsFilePath) {
      try {
        const instructionsContents = await fs.readFile(resolvedInstructionsFilePath, "utf8");
        instructionsPrefix =
          `${instructionsContents}\n\n` +
          `The above agent instructions were loaded from ${resolvedInstructionsFilePath}. Resolve any relative file references from ${instructionsDir}.\n\n`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await onLog(
          "stdout",
          `[paperclip] Warning: could not read agent instructions file \"${resolvedInstructionsFilePath}\": ${reason}\n`,
        );
      }
    }

    const commandNotes = [
      ...preparedRuntimeConfig.notes,
      `Execution cwd resolved to ${cwd}`,
      executionContext.canonicalWorkspaceCwd
        ? `Canonical workspace cwd: ${executionContext.canonicalWorkspaceCwd}`
        : "Canonical workspace cwd unavailable.",
      `Execution workspace source: ${executionContext.executionWorkspaceSource}`,
      ...executionContext.warnings,
    ];

    const prompt = joinPromptSections([
      instructionsPrefix,
      renderTemplate(promptTemplate, {
        agent,
        context,
        run: { id: runId },
        workspace: {
          cwd,
          canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
          canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
          executionWorkspaceId: executionContext.executionWorkspaceId,
          executionWorkspaceSource: executionContext.executionWorkspaceSource,
        },
      }),
      renderPaperclipWakePrompt(context.paperclipWake),
    ]);
    const promptMetrics = {
      promptChars: prompt.length,
      instructionsChars: instructionsPrefix.length,
    };

    const buildArgs = (resumeSessionId: string | null) => {
      const args = ["run", "--format", "json"];
      if (resumeSessionId) args.push("--session", resumeSessionId);
      if (model) args.push("--model", model);
      if (variant) args.push("--variant", variant);
      if (extraArgs.length > 0) args.push(...extraArgs);
      return args;
    };

    const runAttempt = async (resumeSessionId: string | null) => {
      const args = buildArgs(resumeSessionId);
      if (onMeta) {
        await onMeta({
          adapterType: "opencode_project_local",
          command: resolvedCommand,
          cwd,
          commandNotes,
          commandArgs: [...args, `<stdin prompt ${prompt.length} chars>`],
          env: loggedEnv,
          prompt,
          promptMetrics,
          context: {
            ...context,
            paperclipProjectRuntime: {
              canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
              canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
              executionWorkspaceId: executionContext.executionWorkspaceId,
              executionWorkspaceSource: executionContext.executionWorkspaceSource,
              warnings: executionContext.warnings,
            },
          },
        });
      }

      const proc = await runChildProcess(runId, command, args, {
        cwd,
        env: runtimeEnv,
        stdin: prompt,
        timeoutSec,
        graceSec,
        onSpawn,
        onLog,
      });
      return {
        proc,
        rawStderr: proc.stderr,
        parsed: parseOpenCodeJsonl(proc.stdout),
      };
    };

    const toResult = (
      attempt: {
        proc: { exitCode: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string };
        rawStderr: string;
        parsed: ParsedJsonlResult;
      },
      clearSessionOnMissingSession = false,
    ): AdapterExecutionResult => {
      if (attempt.proc.timedOut) {
        return {
          exitCode: attempt.proc.exitCode,
          signal: attempt.proc.signal,
          timedOut: true,
          errorMessage: `Timed out after ${timeoutSec}s`,
          clearSession: clearSessionOnMissingSession,
        };
      }

      const resolvedSessionId =
        attempt.parsed.sessionId ?? (clearSessionOnMissingSession ? null : runtimeSessionId || runtime.sessionId || null);
      const resolvedSessionParams = resolvedSessionId
        ? ({
            sessionId: resolvedSessionId,
            cwd,
            ...(executionContext.executionWorkspaceId ? { workspaceId: executionContext.executionWorkspaceId } : {}),
            ...(executionContext.repoUrl ? { repoUrl: executionContext.repoUrl } : {}),
            ...(executionContext.repoRef ? { repoRef: executionContext.repoRef } : {}),
            ...(executionContext.canonicalWorkspaceId ? { canonicalWorkspaceId: executionContext.canonicalWorkspaceId } : {}),
            ...(executionContext.canonicalWorkspaceCwd ? { canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd } : {}),
            executionWorkspaceSource: executionContext.executionWorkspaceSource,
          } as Record<string, unknown>)
        : null;

      const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
      const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
      const rawExitCode = attempt.proc.exitCode;
      const synthesizedExitCode = parsedError && (rawExitCode ?? 0) === 0 ? 1 : rawExitCode;
      const fallbackErrorMessage = parsedError || stderrLine || `OpenCode exited with code ${synthesizedExitCode ?? -1}`;
      const modelId = model || null;

      return {
        exitCode: synthesizedExitCode,
        signal: attempt.proc.signal,
        timedOut: false,
        errorMessage: (synthesizedExitCode ?? 0) === 0 ? null : fallbackErrorMessage,
        errorMeta: {
          canonicalWorkspaceId: executionContext.canonicalWorkspaceId,
          canonicalWorkspaceCwd: executionContext.canonicalWorkspaceCwd,
          executionWorkspaceId: executionContext.executionWorkspaceId,
          executionWorkspaceSource: executionContext.executionWorkspaceSource,
          warnings: executionContext.warnings,
        },
        usage: {
          inputTokens: attempt.parsed.usage.inputTokens,
          outputTokens: attempt.parsed.usage.outputTokens,
          cachedInputTokens: attempt.parsed.usage.cachedInputTokens,
        },
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        provider: parseModelProvider(modelId),
        biller: resolveOpenCodeBiller(runtimeEnv, parseModelProvider(modelId)),
        model: modelId,
        billingType: "unknown",
        costUsd: attempt.parsed.costUsd,
        resultJson: {
          stdout: attempt.proc.stdout,
          stderr: attempt.proc.stderr,
        },
        summary: attempt.parsed.summary,
        clearSession: Boolean(clearSessionOnMissingSession && !attempt.parsed.sessionId),
      };
    };

    const initial = await runAttempt(sessionId);
    const initialFailed = !initial.proc.timedOut && ((initial.proc.exitCode ?? 0) !== 0 || Boolean(initial.parsed.errorMessage));
    if (sessionId && initialFailed && isOpenCodeUnknownSessionError(initial.proc.stdout, initial.rawStderr)) {
      await onLog("stdout", `[paperclip] OpenCode session \"${sessionId}\" is unavailable; retrying with a fresh session.\n`);
      const retry = await runAttempt(null);
      return toResult(retry, true);
    }

    return toResult(initial);
  } finally {
    await preparedRuntimeConfig.cleanup();
  }
}

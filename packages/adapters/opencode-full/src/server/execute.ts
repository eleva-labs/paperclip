import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { inferOpenAiCompatibleBiller } from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
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
import type { OpencodeFullLocalCliRuntimeConfig, OpencodeFullRemoteServerRuntimeConfig } from "./config-schema.js";
import {
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
} from "./models.js";
import { buildRemoteAuthHeaders, validateResolvedRemoteAuth } from "./remote-auth.js";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";
import { createRemoteSessionParams, getRemoteSessionResumeDecision } from "./session-codec.js";

type ParsedJsonlResult = {
  sessionId: string | null;
  summary: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  costUsd: number;
  errorMessage: string | null;
};

export type LocalCliSessionParams = {
  executionMode: "local_cli";
  sessionId: string;
  cwd: string;
  workspaceId?: string;
  repoUrl?: string;
  repoRef?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
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

export function parseOpenCodeJsonl(stdout: string): ParsedJsonlResult {
  let sessionId: string | null = null;
  const messages: string[] = [];
  const errors: string[] = [];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
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

export function isOpenCodeUnknownSessionError(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return /unknown\s+session|session\b.*\bnot\s+found|resource\s+not\s+found:.*[\\/]session[\\/].*\.json|notfounderror|no session/i.test(
    haystack,
  );
}

export function deserializeLocalCliSessionParams(raw: unknown): LocalCliSessionParams | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const sessionId =
    asString(record.sessionId, "").trim() ||
    asString(record.session_id, "").trim() ||
    asString(record.sessionID, "").trim();
  const cwd = asString(record.cwd, "").trim() || asString(record.workdir, "").trim() || asString(record.folder, "").trim();
  const executionMode = asString(record.executionMode, "").trim();
  if (!sessionId || !cwd || executionMode !== "local_cli") return null;

  const workspaceId = asString(record.workspaceId, "").trim() || asString(record.workspace_id, "").trim();
  const repoUrl = asString(record.repoUrl, "").trim() || asString(record.repo_url, "").trim();
  const repoRef = asString(record.repoRef, "").trim() || asString(record.repo_ref, "").trim();

  return {
    executionMode: "local_cli",
    sessionId,
    cwd,
    ...(workspaceId ? { workspaceId } : {}),
    ...(repoUrl ? { repoUrl } : {}),
    ...(repoRef ? { repoRef } : {}),
  };
}

export function serializeLocalCliSessionParams(params: Record<string, unknown> | null): Record<string, unknown> | null {
  const parsed = deserializeLocalCliSessionParams(params);
  return parsed ? { ...parsed } : null;
}

function joinRemoteUrl(baseUrl: string, pathname: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const pathValue = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${pathValue}`;
}

function normalizeRemoteUsage(raw: unknown): { inputTokens: number; cachedInputTokens: number; outputTokens: number } {
  const usage = parseObject(raw);
  return {
    inputTokens: asNumber(usage.inputTokens, asNumber(usage.input, 0)),
    cachedInputTokens: asNumber(usage.cachedInputTokens, asNumber(parseObject(usage.cache).read, 0)),
    outputTokens: asNumber(usage.outputTokens, asNumber(usage.output, 0)),
  };
}

function toRemoteExecutionError(code: string, message: string, detail?: string | null): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: code,
    errorMessage: message,
    errorMeta: detail ? { detail } : undefined,
    sessionParams: null,
    sessionDisplayId: null,
    summary: null,
  };
}

async function executeRemoteServer(
  ctx: AdapterExecutionContext,
  config: OpencodeFullRemoteServerRuntimeConfig,
): Promise<AdapterExecutionResult> {
  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") {
    return toRemoteExecutionError(target.code, target.message);
  }

  const authCheck = validateResolvedRemoteAuth(config.remoteServer.auth);
  if (!authCheck.ok) {
    return toRemoteExecutionError("REMOTE_AUTH_UNRESOLVED", authCheck.reason);
  }

  try {
    await ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toRemoteExecutionError(
      /authentication/i.test(message) ? "REMOTE_AUTH_REJECTED" : "REMOTE_MODEL_INVALID",
      message,
    );
  }

  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const prompt = joinPromptSections([
    renderTemplate(promptTemplate, { agent: ctx.agent, context: ctx.context, run: { id: ctx.runId } }),
    renderPaperclipWakePrompt(ctx.context.paperclipWake),
  ]);

  const resumeDecision = getRemoteSessionResumeDecision({
    companyId: ctx.agent.companyId,
    agentId: ctx.agent.id,
    config,
    sessionParams: ctx.runtime.sessionParams,
  });
  const parsedRuntimeSession = parseObject(ctx.runtime.sessionParams);
  const resumeSessionId = resumeDecision.shouldResume
    ? asString(parsedRuntimeSession.remoteSessionId, "").trim() || ctx.runtime.sessionId || null
    : null;

  if (!resumeDecision.shouldResume && ctx.runtime.sessionParams) {
    await ctx.onLog(
      "stdout",
      `[paperclip] Remote session resume refused; starting fresh because ${resumeDecision.reason ?? "resume eligibility changed"}.\n`,
    );
  }

  if (ctx.onMeta) {
    await ctx.onMeta({
      adapterType: "opencode_full",
      command: "remote_server",
      cwd: config.remoteServer.baseUrl,
      commandArgs: ["POST", "/sessions/execute"],
      commandNotes: [
        `Execution mode: ${config.executionMode}`,
        `Remote base URL: ${config.remoteServer.baseUrl}`,
        `Remote target mode: ${target.targetMode}`,
        `Resolved target identity: ${target.resolvedTargetIdentity}`,
        resumeSessionId ? `Resume requested for remote session ${resumeSessionId}` : "Fresh remote session requested",
      ],
      env: {},
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context: ctx.context,
    });
  }

  const controller = new AbortController();
  const timeoutSec = asNumber(config.timeoutSec, 120);
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutSec) * 1000);

  try {
    const response = await fetch(joinRemoteUrl(config.remoteServer.baseUrl, "/sessions/execute"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...buildRemoteAuthHeaders(authCheck.auth),
      },
      body: JSON.stringify({
        runId: ctx.runId,
        companyId: ctx.agent.companyId,
        agentId: ctx.agent.id,
        model: config.model,
        variant: config.variant,
        prompt,
        sessionId: resumeSessionId,
        target: {
          mode: target.targetMode,
          resolvedTargetIdentity: target.resolvedTargetIdentity,
        },
      }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload: unknown = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    if (response.status === 401 || response.status === 403) {
      return toRemoteExecutionError("REMOTE_AUTH_REJECTED", `Remote server rejected authentication (${response.status}).`, rawText || null);
    }
    if (!response.ok) {
      return toRemoteExecutionError(
        response.status >= 500 ? "REMOTE_SERVER_ERROR" : "REMOTE_EXECUTION_FAILED",
        `Remote execution failed (${response.status}).`,
        rawText || null,
      );
    }

    const body = parseObject(payload);
    const remoteSessionId = asString(body.remoteSessionId, "").trim() || asString(body.sessionId, "").trim();
    if (!remoteSessionId) {
      return toRemoteExecutionError("REMOTE_SESSION_MISSING", "Remote execution response did not include a session id.");
    }

    const summary =
      asString(body.summary, "").trim() ||
      asString(body.outputText, "").trim() ||
      asString(body.result, "").trim() ||
      null;
    const usage = normalizeRemoteUsage(body.usage);
    const sessionParams = createRemoteSessionParams({
      companyId: ctx.agent.companyId,
      agentId: ctx.agent.id,
      config,
      remoteSessionId,
      canonicalWorkspaceId: null,
      canonicalWorkspaceCwd: null,
      serverScope: "unknown",
    });

    return {
      exitCode: asNumber(body.exitCode, 0),
      signal: null,
      timedOut: false,
      errorMessage: asString(body.errorMessage, "").trim() || null,
      usage,
      sessionId: remoteSessionId,
      sessionParams,
      sessionDisplayId: remoteSessionId,
      provider: parseModelProvider(config.model),
      biller: resolveOpenCodeBiller({}, parseModelProvider(config.model)),
      model: config.model,
      billingType: "unknown",
      costUsd: asNumber(body.costUsd, 0),
      resultJson: isPlainObject(body.resultJson)
        ? body.resultJson
        : { response: payload, requestedTarget: target.resolvedTargetIdentity },
      summary,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        exitCode: 1,
        signal: null,
        timedOut: true,
        errorCode: "REMOTE_TIMEOUT",
        errorMessage: `Remote execution timed out after ${timeoutSec}s.`,
        sessionParams: null,
        sessionDisplayId: null,
        summary: null,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return toRemoteExecutionError("REMOTE_UNREACHABLE", `Remote execution could not reach ${config.remoteServer.baseUrl}.`, message);
  } finally {
    clearTimeout(timer);
  }
}

function resolveLocalExecutionMetadata(context: Record<string, unknown>) {
  const workspace = parseObject(context.paperclipWorkspace);
  const cwd = asString(workspace.cwd, "").trim() || process.cwd();
  const workspaceId = asString(workspace.workspaceId, "").trim() || null;
  const repoUrl = asString(workspace.repoUrl, "").trim() || null;
  const repoRef = asString(workspace.repoRef, "").trim() || null;
  const warnings = asString(workspace.cwd, "").trim()
    ? []
    : ["Paperclip workspace cwd was unavailable; local_cli fell back to the host process cwd."];
  return { cwd, workspaceId, repoUrl, repoRef, warnings };
}

export async function executeLocalCli(
  ctx: AdapterExecutionContext,
  config: OpencodeFullLocalCliRuntimeConfig,
): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const execution = resolveLocalExecutionMetadata(context);
  const cwd = execution.cwd;

  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const hasExplicitApiKey = typeof config.localCli.env.PAPERCLIP_API_KEY === "string" && config.localCli.env.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason = typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0 ? context.wakeReason.trim() : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId = typeof context.approvalId === "string" && context.approvalId.trim().length > 0 ? context.approvalId.trim() : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0 ? context.approvalStatus.trim() : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
  if (execution.workspaceId) env.PAPERCLIP_WORKSPACE_ID = execution.workspaceId;
  if (execution.repoUrl) env.PAPERCLIP_WORKSPACE_REPO_URL = execution.repoUrl;
  if (execution.repoRef) env.PAPERCLIP_WORKSPACE_REPO_REF = execution.repoRef;
  if (cwd) env.PAPERCLIP_WORKSPACE_CWD = cwd;

  for (const [key, value] of Object.entries(config.localCli.env)) {
    if (typeof value === "string") env[key] = value;
  }
  if (!hasExplicitApiKey && authToken) env.PAPERCLIP_API_KEY = authToken;

  const preparedRuntimeConfig = await prepareLocalCliRuntimeConfig({ env, config, cwd });
  try {
    const runtimeEnv = Object.fromEntries(
      Object.entries(ensurePathInEnv({ ...process.env, ...preparedRuntimeConfig.env })).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );

    await ensureCommandResolvable(config.localCli.command, cwd, runtimeEnv);
    const resolvedCommand = await resolveCommandForLogs(config.localCli.command, cwd, runtimeEnv);
    const loggedEnv = buildInvocationEnvForLogs(preparedRuntimeConfig.env, {
      runtimeEnv,
      includeRuntimeKeys: ["HOME"],
      resolvedCommand,
    });

    await ensureLocalCliOpenCodeModelConfiguredAndAvailable({
      model: config.model,
      command: config.localCli.command,
      cwd,
      env: runtimeEnv,
      config,
    });

    for (const warning of execution.warnings) {
      await onLog("stdout", `[paperclip] Warning: ${warning}\n`);
    }

    const timeoutSec = asNumber(config.timeoutSec, 0);
    const graceSec = asNumber(config.localCli.graceSec, 5);
    const prompt = joinPromptSections([
      renderTemplate(promptTemplate, { agent, context, run: { id: runId } }),
      renderPaperclipWakePrompt(context.paperclipWake),
    ]);
    const promptMetrics = { promptChars: prompt.length };
    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const parsedSessionParams = deserializeLocalCliSessionParams(runtimeSessionParams);
    const runtimeSessionId = parsedSessionParams?.sessionId ?? runtime.sessionId ?? null;
    const canResumeSession = Boolean(parsedSessionParams && parsedSessionParams.cwd === cwd);
    const sessionId = canResumeSession ? runtimeSessionId : null;

    if (runtimeSessionParams && !parsedSessionParams) {
      await onLog("stdout", "[paperclip] Warning: Existing session params are invalid for opencode_full local_cli and will be ignored.\n");
    } else if (parsedSessionParams && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Warning: OpenCode session "${parsedSessionParams.sessionId}" was saved for cwd "${parsedSessionParams.cwd}" and will not be resumed in "${cwd}".\n`,
      );
    }

    const buildArgs = (resumeSessionId: string | null) => {
      const args = ["run", "--format", "json"];
      if (resumeSessionId) args.push("--session", resumeSessionId);
      if (config.model) args.push("--model", config.model);
      if (config.variant) args.push("--variant", config.variant);
      return args;
    };

    const runAttempt = async (resumeSessionId: string | null) => {
      const args = buildArgs(resumeSessionId);
      if (onMeta) {
        await onMeta({
          adapterType: "opencode_full",
          command: resolvedCommand,
          cwd,
          commandArgs: [...args, `<stdin prompt ${prompt.length} chars>`],
          commandNotes: [
            ...preparedRuntimeConfig.notes,
            `Execution mode: ${config.executionMode}`,
            `Execution cwd resolved to ${cwd}`,
            ...execution.warnings,
          ],
          env: loggedEnv,
          prompt,
          promptMetrics,
          context,
        });
      }

      const proc = await runChildProcess(runId, config.localCli.command, args, {
        cwd,
        env: runtimeEnv,
        stdin: prompt,
        timeoutSec,
        graceSec,
        onSpawn,
        onLog,
      });
      return { proc, rawStderr: proc.stderr, parsed: parseOpenCodeJsonl(proc.stdout) };
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

      const resolvedSessionId = attempt.parsed.sessionId ?? (clearSessionOnMissingSession ? null : runtimeSessionId);
      const resolvedSessionParams = resolvedSessionId
        ? {
            executionMode: "local_cli" as const,
            sessionId: resolvedSessionId,
            cwd,
            ...(execution.workspaceId ? { workspaceId: execution.workspaceId } : {}),
            ...(execution.repoUrl ? { repoUrl: execution.repoUrl } : {}),
            ...(execution.repoRef ? { repoRef: execution.repoRef } : {}),
          }
        : null;

      const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
      const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
      const rawExitCode = attempt.proc.exitCode;
      const synthesizedExitCode = parsedError && (rawExitCode ?? 0) === 0 ? 1 : rawExitCode;
      const fallbackErrorMessage = parsedError || stderrLine || `OpenCode exited with code ${synthesizedExitCode ?? -1}`;
      const modelId = config.model || null;

      return {
        exitCode: synthesizedExitCode,
        signal: attempt.proc.signal,
        timedOut: false,
        errorMessage: (synthesizedExitCode ?? 0) === 0 ? null : fallbackErrorMessage,
        errorMeta: { warnings: execution.warnings, executionMode: "local_cli" },
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
      await onLog("stdout", `[paperclip] OpenCode session "${sessionId}" is unavailable; retrying with a fresh session.\n`);
      const retry = await runAttempt(null);
      return toResult(retry, true);
    }

    return toResult(initial);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: /not executable|command/i.test(errorMessage) ? "LOCAL_COMMAND_MISSING" : null,
      errorMessage,
      sessionParams: null,
      sessionDisplayId: null,
      summary: null,
    };
  } finally {
    await preparedRuntimeConfig.cleanup();
  }
}

export { executeRemoteServer };

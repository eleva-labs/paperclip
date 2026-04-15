import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { inferOpenAiCompatibleBiller } from "@paperclipai/adapter-utils";
import { asNumber, asString, joinPromptSections, parseObject, renderPaperclipWakePrompt, renderTemplate } from "@paperclipai/adapter-utils/server-utils";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";
import { createRemoteSessionParams, getRemoteSessionResumeDecision } from "./session-codec.js";
import { ensureRemoteServerOpenCodeModelConfiguredAndAvailable } from "./remote-models.js";
import {
  createRemoteSession,
  getRemoteSession,
  getRemoteSessionMessages,
  getRemoteSessionStatus,
  postRemoteSessionMessage,
  readRemoteError,
  readSessionId,
  readUsage,
} from "./remote-client.js";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";
import { validateResolvedRemoteAuth } from "./remote-auth.js";

function provider(model: string) {
  return model.includes("/") ? model.slice(0, model.indexOf("/")) : null;
}

function code(err: string): AdapterExecutionResult["errorCode"] {
  switch (err) {
    case "auth_unresolved":
      return "AUTH_UNRESOLVED";
    case "auth_rejected":
      return "AUTH_REJECTED";
    case "health_failed":
      return "HEALTH_FAILED";
    case "model_invalid":
      return "MODEL_INVALID";
    case "session_invalid":
      return "SESSION_INVALID_OR_STALE";
    case "ownership":
      return "OWNERSHIP_MISMATCH";
    case "target":
      return "TARGET_ISOLATION_FAILED";
    case "timeout":
      return "TIMEOUT";
    default:
      return "EXECUTION_FAILED";
  }
}

function failure(kind: string, message: string, meta?: Record<string, unknown>): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: kind === "timeout",
    errorCode: code(kind),
    errorMessage: message,
    errorMeta: meta,
    sessionParams: null,
    sessionDisplayId: null,
    summary: null,
  };
}

function summary(message: unknown, messages: unknown): string | null {
  const direct = asString(parseObject(message).text, "").trim() || asString(parseObject(parseObject(message).info).text, "").trim();
  if (direct) return direct;
  if (!Array.isArray(messages)) return null;
  const texts = messages.flatMap((value) => {
    const entry = parseObject(value);
    const parts = Array.isArray(entry.parts) ? entry.parts : [];
    return parts
      .map((part) => asString(parseObject(part).text, "").trim())
      .filter(Boolean);
  });
  return texts.length > 0 ? texts.join("\n\n") : null;
}

function classify(
  status: number,
  payload: unknown,
  text: string,
  options: { allowSessionNotFound: boolean },
) {
  const msg = readRemoteError(payload, text, `Remote execution failed (${status}).`);
  const normalized = `${msg} ${text}`.toLowerCase();
  if (status === 401 || status === 403 || /auth|unauthor|forbidden/.test(normalized)) return failure("auth_rejected", msg);
  if (/ownership|agent|company/.test(normalized)) return failure("ownership", msg);
  if (/target|workspace|namespace|isolation/.test(normalized)) return failure("target", msg);
  if (
    (options.allowSessionNotFound && status === 404)
    || /unknown session|session\b.*(missing|not found|invalid|stale)|stale/.test(normalized)
  ) {
    return failure("session_invalid", msg);
  }
  if (/model/.test(normalized) || status === 422) return failure("model_invalid", msg);
  return failure("execution", msg);
}

export async function executeRemoteServer(
  ctx: AdapterExecutionContext,
  config: OpencodeFullRemoteServerRuntimeConfig,
): Promise<AdapterExecutionResult> {
  const target = resolveRemoteTargetIdentity(config.remoteServer.projectTarget);
  if (target.status !== "resolved") return failure("target", target.message);

  const auth = validateResolvedRemoteAuth(config.remoteServer.auth);
  if (!auth.ok) return failure("auth_unresolved", auth.reason);
  if (config.remoteServer.auth.mode !== "none") {
    return failure("auth_unresolved", "MVP remote execution currently supports only auth.mode=none; other auth branches remain schema placeholders.");
  }

  try {
    await ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config);
  } catch (err) {
    return failure("model_invalid", err instanceof Error ? err.message : String(err));
  }

  const prompt = joinPromptSections([
    renderTemplate(asString(config.promptTemplate, "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work."), {
      agent: ctx.agent,
      context: ctx.context,
      run: { id: ctx.runId },
    }),
    renderPaperclipWakePrompt(ctx.context.paperclipWake),
  ]);

  const decision = getRemoteSessionResumeDecision({
    companyId: ctx.agent.companyId,
    agentId: ctx.agent.id,
    config,
    sessionParams: ctx.runtime.sessionParams,
  });
  const saved = parseObject(ctx.runtime.sessionParams);
  const prior = decision.shouldResume
    ? asString(saved.remoteSessionId, "").trim() || asString(saved.sessionId, "").trim() || ctx.runtime.sessionId || null
    : null;

  if (!decision.shouldResume && ctx.runtime.sessionParams) {
    await ctx.onLog("stdout", `[paperclip] Remote session resume refused; starting fresh because ${decision.reason ?? "resume eligibility changed"}.\n`);
  }

  let sessionId = prior;
  if (sessionId) {
    const session = await getRemoteSession(config, sessionId);
    const status = await getRemoteSessionStatus(config);
    if (!session.ok || (status.ok && !Object.prototype.hasOwnProperty.call(parseObject(status.data), sessionId))) {
      sessionId = null;
      await ctx.onLog("stdout", `[paperclip] Remote session \"${prior}\" is unavailable; starting a fresh session.\n`);
    }
  }

  if (!sessionId) {
    const created = await createRemoteSession(config, {});
    if (!created.ok) return classify(created.status, created.data, created.text, { allowSessionNotFound: false });
    sessionId = readSessionId(created.data);
    if (!sessionId) return failure("execution", "Remote session create response did not include a session id.");
  }

  if (ctx.onMeta) {
    await ctx.onMeta({
      adapterType: "opencode_full",
      command: "remote_server",
      cwd: config.remoteServer.baseUrl,
      commandArgs: ["POST", "/session", "POST", `/session/${sessionId}/message`],
      commandNotes: [
        `Execution mode: ${config.executionMode}`,
        `Remote base URL: ${config.remoteServer.baseUrl}`,
        `Remote target mode: ${target.targetMode}`,
        sessionId === prior && prior ? `Resume requested for remote session ${prior}` : "Fresh remote session requested",
      ],
      env: {},
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context: ctx.context,
    });
  }

  try {
    const response = await postRemoteSessionMessage(config, sessionId, {
      model: {
        providerID: provider(config.model),
        modelID: config.model.includes("/") ? config.model.slice(config.model.indexOf("/") + 1) : config.model,
      },
      variant: config.variant,
      system: asString(config.bootstrapPromptTemplate, "").trim() || undefined,
      parts: [{ type: "text", text: prompt }],
    });
    if (!response.ok) return classify(response.status, response.data, response.text, { allowSessionNotFound: true });

    const messages = await getRemoteSessionMessages(config, sessionId);
    const payload = parseObject(response.data);
    const session = createRemoteSessionParams({
      companyId: ctx.agent.companyId,
      agentId: ctx.agent.id,
      config,
      remoteSessionId: sessionId,
    });
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      errorMessage: null,
      usage: readUsage(parseObject(payload.info)),
      costUsd: asNumber(parseObject(payload.info).cost, 0),
      provider: provider(config.model),
      biller: inferOpenAiCompatibleBiller({}, null) ?? provider(config.model) ?? "unknown",
      model: config.model,
      billingType: "unknown",
      sessionId,
      sessionParams: session,
      sessionDisplayId: sessionId,
      summary: summary(response.data, messages.data),
      resultJson: {
        message: response.data,
        messages: messages.ok ? messages.data : null,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return failure("timeout", `Remote execution timed out after ${config.timeoutSec}s.`);
    }
    return failure("execution", `Remote execution could not reach ${config.remoteServer.baseUrl}.`, {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

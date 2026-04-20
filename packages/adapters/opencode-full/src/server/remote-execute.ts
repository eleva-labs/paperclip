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
  subscribeRemoteGlobalEvents,
} from "./remote-client.js";
import type { RemoteGlobalEventSubscription } from "./remote-client.js";
import { resolveLinkedRemoteTarget } from "./remote-targeting.js";
import { validateResolvedRemoteAuth } from "./remote-auth.js";
import type { OpencodeRemoteGlobalEventEnvelope, OpencodeFullRemoteLiveEvent } from "./remote-stream-schema.js";
import {
  createRemoteStreamCursor,
  createRemoteStreamDroppedEvents,
  processRemoteEnvelope,
  flushReasoningBuffers,
} from "./remote-stream.js";
import type { RemoteStreamDroppedEvents } from "./remote-stream.js";

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
    case "stream_connect_failed":
      return "STREAM_CONNECT_FAILED";
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

// ---------------------------------------------------------------------------
// Reconciliation — design $4.5
// ---------------------------------------------------------------------------

/**
 * Build reconciliation warnings from stream diagnostics and final payload
 * comparison. The stream never becomes the sole completion source; final
 * payloads are authoritative.
 */
function buildReconciliationWarnings(
  dropped: RemoteStreamDroppedEvents,
  streamDegraded: boolean,
  degradeReason: string | null,
  subscriptionDroppedEvents: number,
): string[] {
  const warnings: string[] = [];

  const totalDropped = dropped.total + subscriptionDroppedEvents;
  if (totalDropped > 0) {
    const parts: string[] = [];
    if (dropped.sessionMismatch > 0) parts.push(`sessionMismatch=${dropped.sessionMismatch}`);
    if (dropped.malformed > 0) parts.push(`malformed=${dropped.malformed}`);
    if (dropped.unsupportedPartType > 0) parts.push(`unsupportedPartType=${dropped.unsupportedPartType}`);
    if (dropped.unmappable > 0) parts.push(`unmappable=${dropped.unmappable}`);
    if (dropped.bufferOverflow > 0) parts.push(`bufferOverflow=${dropped.bufferOverflow}`);
    if (subscriptionDroppedEvents > 0) parts.push(`transportDropped=${subscriptionDroppedEvents}`);
    warnings.push(`Remote stream dropped ${totalDropped} event(s): ${parts.join(", ")}`);
  }

  if (streamDegraded) {
    warnings.push(`Remote stream degraded during run${degradeReason ? `: ${degradeReason}` : ""}`);
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Execute — design $4.4
// ---------------------------------------------------------------------------

export async function executeRemoteServer(
  ctx: AdapterExecutionContext,
  config: OpencodeFullRemoteServerRuntimeConfig,
): Promise<AdapterExecutionResult> {
  // Step 1: Resolve linked remote target and auth
  const target = resolveLinkedRemoteTarget(config);
  if (target.status !== "resolved") return failure("target", target.message, { code: target.code });

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

  // Step 2: Create or resume the remote session
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
      commandArgs: target.directoryQuery
        ? ["POST", `/session?directory=${target.directoryQuery}`, "POST", `/session/${sessionId}/message?directory=${target.directoryQuery}`]
        : ["POST", "/session", "POST", `/session/${sessionId}/message`],
      commandNotes: [
        `Execution mode: ${config.executionMode}`,
        `Remote base URL: ${config.remoteServer.baseUrl}`,
        `Remote target mode: ${target.targetMode}`,
        target.directoryQuery ? `Remote directory hint: ${target.directoryQuery}` : "No directory hint required",
        sessionId === prior && prior ? `Resume requested for remote session ${prior}` : "Fresh remote session requested",
        "Live streaming parity: /global/event SSE subscription active",
      ],
      env: {},
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context: ctx.context,
    });
  }

  // Step 3: Subscribe to /global/event and wait for server.connected
  const linkedDirectoryHint = target.directoryQuery ?? config.remoteServer.baseUrl;
  let cursor = createRemoteStreamCursor(sessionId, linkedDirectoryHint);
  const dropped = createRemoteStreamDroppedEvents();
  const streamedEvents: OpencodeFullRemoteLiveEvent[] = [];
  let streamDegraded = false;
  let degradeReason: string | null = null;

  let subscription: RemoteGlobalEventSubscription | null = null;

  const onEnvelope = async (envelope: OpencodeRemoteGlobalEventEnvelope): Promise<void> => {
    const result = processRemoteEnvelope({ envelope, cursor, dropped });
    cursor = result.cursor;
    streamedEvents.push(...result.events);

    // Emit JSONL lines immediately via ctx.onLog (design $4.4 step 6)
    for (const line of result.lines) {
      await ctx.onLog("stdout", line + "\n");
    }
  };

  try {
    subscription = await subscribeRemoteGlobalEvents({
      config,
      onEnvelope,
    });
  } catch (err) {
    // Pre-submit stream establishment failure aborts the run (design $4.4 / $6)
    return failure("stream_connect_failed", `Remote stream subscribe failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await subscription.connected;
  } catch (err) {
    // Pre-handshake failure: hard abort (design $4.1 / $6)
    await subscription.close();
    return failure("stream_connect_failed", `Remote stream handshake failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 4: Emit step_start when the live stream is ready
  // The connected event was already processed by onEnvelope which emitted
  // a step_start line through processRemoteEnvelope. But if the directory
  // didn't match (e.g., server_default mode with no directory hint), we
  // emit step_start explicitly.
  const emittedStepStart = streamedEvents.some((e) => e.kind === "connected");
  if (!emittedStepStart) {
    await ctx.onLog("stdout", JSON.stringify({ type: "step_start", sessionID: sessionId }) + "\n");
  }

  // Step 5: Submit POST /session/{id}/message
  try {
    // Run the prompt POST concurrently with stream consumption.
    // The stream pump runs in the background (started by subscribeRemoteGlobalEvents).
    // The POST is the blocking call; envelopes arrive via onEnvelope.
    const response = await postRemoteSessionMessage(config, sessionId, {
      model: {
        providerID: provider(config.model),
        modelID: config.model.includes("/") ? config.model.slice(config.model.indexOf("/") + 1) : config.model,
      },
      variant: config.variant,
      system: asString(config.bootstrapPromptTemplate, "").trim() || undefined,
      parts: [{ type: "text", text: prompt }],
    });

    if (!response.ok) {
      // Prompt failure after handshake (design $6 PROMPT_FAILED_AFTER_STREAM_READY)
      await ctx.onLog("stdout", JSON.stringify({ type: "error", error: `Remote prompt failed: ${response.status}` }) + "\n");
      await subscription.close();
      return classify(response.status, response.data, response.text, { allowSessionNotFound: true });
    }

    // Step 6b: Detect mid-run stream disconnection by checking if the
    // pump already exited. We track settlement via a synchronous flag set
    // by the `done` promise's resolution callback. `Promise.race` with an
    // extra `.then()` hop cannot reliably detect already-settled promises
    // because microtask ordering makes the sentinel win, so a sync flag
    // is the correct pattern here.
    let pumpExited = false;
    subscription.done.then(
      () => { pumpExited = true; },
      () => { pumpExited = true; },
    );
    // Yield one microtask so the flag can be set if `done` was
    // already settled before we got here.
    await Promise.resolve();
    if (pumpExited) {
      // Post-submit disconnect: emit remote_stream_gap and mark degraded
      streamDegraded = true;
      degradeReason = "SSE stream ended unexpectedly during active run";
      cursor = { ...cursor, degraded: true, degradeReason };
      await ctx.onLog("stdout", JSON.stringify({
        type: "remote_stream_gap",
        sessionID: sessionId,
        reason: degradeReason,
      }) + "\n");
    }

    // Step 7-8: Terminal completion. Fetch final session/message payloads
    // for authoritative reconciliation.
    const messages = await getRemoteSessionMessages(config, sessionId);

    // Step 10: Flush pending reasoning buffers before reconciliation
    const flushResult = flushReasoningBuffers(cursor);
    cursor = flushResult.cursor;
    for (const line of flushResult.lines) {
      await ctx.onLog("stdout", line + "\n");
    }

    // Check if stream degraded during run (may have been set above or
    // by the cursor if future code paths mark it directly)
    if (!streamDegraded) {
      streamDegraded = cursor.degraded;
      degradeReason = cursor.degradeReason;
    }

    // Close the stream
    const subscriptionDroppedEvents = subscription.droppedEvents();
    await subscription.close();

    // Build reconciliation warnings (design $4.5)
    const reconciliationWarnings = buildReconciliationWarnings(
      dropped,
      streamDegraded,
      degradeReason,
      subscriptionDroppedEvents,
    );

    const payload = parseObject(response.data);
    const session = createRemoteSessionParams({
      companyId: ctx.agent.companyId,
      agentId: ctx.agent.id,
      config,
      remoteSessionId: sessionId,
      canonicalWorkspaceId: config.remoteServer.linkRef?.canonicalWorkspaceId ?? null,
      linkedDirectoryHint: target.directoryQuery,
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
        remoteStream: {
          degraded: streamDegraded,
          degradeReason,
          streamedEventCount: streamedEvents.length,
        },
        remoteStreamDroppedEvents: {
          ...dropped,
          transportDropped: subscriptionDroppedEvents,
        },
        ...(reconciliationWarnings.length > 0 ? { reconciliationWarnings } : {}),
      },
    };
  } catch (err) {
    // Post-submit errors: stream may have degraded or the POST itself failed
    if (subscription) {
      // Flush reasoning before closing
      const flushResult = flushReasoningBuffers(cursor);
      cursor = flushResult.cursor;
      for (const line of flushResult.lines) {
        try {
          await ctx.onLog("stdout", line + "\n");
        } catch {
          // Best-effort flush
        }
      }
      await subscription.close();
    }

    if (err instanceof Error && err.name === "AbortError") {
      return failure("timeout", `Remote execution timed out after ${config.timeoutSec}s.`);
    }
    return failure("execution", `Remote execution could not reach ${config.remoteServer.baseUrl}.`, {
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

import { parseObject, asString } from "@paperclipai/adapter-utils/server-utils";
import type {
  OpencodeRemoteGlobalEventEnvelope,
  OpencodeFullRemoteStreamCursor,
  OpencodeFullRemoteLiveEvent,
  OpencodeFullSyntheticLogLine,
} from "./remote-stream-schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of pending (out-of-order) deltas to buffer per stream
 * before dropping the oldest entries. This bounds memory usage when
 * `message.part.delta` events arrive before their corresponding
 * `message.part.updated`.
 */
const MAX_PENDING_DELTAS = 64;

/**
 * Part types that MVP streaming parity covers.
 * Everything else is ignored and counted via the diagnostic surface.
 */
const MVP_PART_TYPES = new Set(["text", "reasoning", "tool"]);

// ---------------------------------------------------------------------------
// Cursor factory
// ---------------------------------------------------------------------------

export function createRemoteStreamCursor(
  remoteSessionId: string,
  linkedDirectoryHint: string,
): OpencodeFullRemoteStreamCursor {
  return {
    remoteSessionId,
    linkedDirectoryHint,
    messageId: null,
    activePartIds: [],
    seenPartTypes: {},
    pendingPartDeltas: {},
    reasoningBuffers: {},
    connectedAt: null,
    lastEventAt: null,
    degraded: false,
    degradeReason: null,
  };
}

// ---------------------------------------------------------------------------
// Diagnostic surface: dropped-event accumulator
// ---------------------------------------------------------------------------

/**
 * Mutable diagnostic accumulator readable by downstream reconciliation
 * (Cycle 3.1). The surface tracks counts by category so reconciliation
 * can factor them into `reconciliationWarnings` on `resultJson`.
 */
export type RemoteStreamDroppedEvents = {
  /** Total number of dropped events across all categories. */
  total: number;
  /** Events where directory matched but session did not. */
  sessionMismatch: number;
  /** Events with malformed/missing required properties. */
  malformed: number;
  /** Events for unsupported/deferred part types. */
  unsupportedPartType: number;
  /** Events that could not be mapped into any JSONL output. */
  unmappable: number;
  /** Pending deltas that overflowed the bounded buffer. */
  bufferOverflow: number;
};

export function createRemoteStreamDroppedEvents(): RemoteStreamDroppedEvents {
  return {
    total: 0,
    sessionMismatch: 0,
    malformed: 0,
    unsupportedPartType: 0,
    unmappable: 0,
    bufferOverflow: 0,
  };
}

function countDrop(
  dropped: RemoteStreamDroppedEvents,
  category: keyof Omit<RemoteStreamDroppedEvents, "total">,
): void {
  dropped[category] += 1;
  dropped.total += 1;
}

// ---------------------------------------------------------------------------
// Correlator — design §4.2
// ---------------------------------------------------------------------------

export type CorrelateRemoteEnvelopeInput = {
  envelope: OpencodeRemoteGlobalEventEnvelope;
  cursor: OpencodeFullRemoteStreamCursor;
  dropped: RemoteStreamDroppedEvents;
};

export type CorrelateRemoteEnvelopeResult = {
  matched: boolean;
  cursor: OpencodeFullRemoteStreamCursor;
  events: OpencodeFullRemoteLiveEvent[];
};

/**
 * Correlate an incoming global SSE envelope to the active run.
 *
 * Design contract:
 * 1. Filter by `envelope.directory === cursor.linkedDirectoryHint`.
 * 2. For session-scoped events, require `sessionID === cursor.remoteSessionId`.
 * 3. Update cursor state (messageId, activePartIds, seenPartTypes).
 * 4. Buffer bounded out-of-order deltas.
 * 5. Remove part-local state on `message.part.removed`.
 *
 * Returns zero or more normalized events. Most envelopes produce exactly
 * one event, but a `message.part.updated` that flushes pending deltas may
 * produce a preceding `message_delta` before the `message_part`.
 */
export function correlateRemoteEnvelope(
  input: CorrelateRemoteEnvelopeInput,
): CorrelateRemoteEnvelopeResult {
  const { envelope, dropped } = input;
  // Shallow-copy cursor so the caller keeps an immutable reference to old
  // state if needed. Deep fields that get mutated are also shallow-copied
  // below before mutation.
  const cursor: OpencodeFullRemoteStreamCursor = { ...input.cursor };
  const ts = new Date().toISOString();

  // 1. Directory filter
  if (envelope.directory !== cursor.linkedDirectoryHint) {
    // Not our directory — silent ignore (no counter per mapping table:
    // heartbeat/comment SSE already filtered; directory mismatches are
    // not counted in dropped diagnostics).
    return { matched: false, cursor, events: [] };
  }

  const payloadType = envelope.payload.type;
  const props = parseObject(envelope.payload.properties);

  // `server.connected` — no session binding required
  if (payloadType === "server.connected") {
    const updatedCursor = {
      ...cursor,
      connectedAt: ts,
      lastEventAt: ts,
    };
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "connected",
      ts,
      sessionId: cursor.remoteSessionId,
      directory: envelope.directory,
    };
    return { matched: true, cursor: updatedCursor, events: [event] };
  }

  // All remaining recognized event types require sessionID correlation.
  const eventSessionId = asString(props.sessionID, "").trim();

  // `session.status`
  if (payloadType === "session.status") {
    if (!eventSessionId) {
      countDrop(dropped, "malformed");
      return { matched: false, cursor, events: [] };
    }
    if (eventSessionId !== cursor.remoteSessionId) {
      countDrop(dropped, "sessionMismatch");
      return { matched: false, cursor, events: [] };
    }
    const status = asString(props.status, "").trim();
    if (!status) {
      countDrop(dropped, "malformed");
      return { matched: false, cursor, events: [] };
    }
    const updatedCursor = { ...cursor, lastEventAt: ts };
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "status",
      ts,
      sessionId: eventSessionId,
      status,
    };
    return { matched: true, cursor: updatedCursor, events: [event] };
  }

  // `session.error`
  if (payloadType === "session.error") {
    if (!eventSessionId) {
      countDrop(dropped, "malformed");
      return { matched: false, cursor, events: [] };
    }
    if (eventSessionId !== cursor.remoteSessionId) {
      countDrop(dropped, "sessionMismatch");
      return { matched: false, cursor, events: [] };
    }
    const errorObj = parseObject(props.error) as Record<string, unknown>;
    const msg =
      asString(errorObj?.message, "").trim() ||
      asString(props.error, "").trim() ||
      asString(props.message, "").trim() ||
      "unknown session error";
    const updatedCursor = { ...cursor, lastEventAt: ts };
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "session_error",
      ts,
      sessionId: eventSessionId,
      message: msg,
      raw: envelope.payload.properties,
    };
    return { matched: true, cursor: updatedCursor, events: [event] };
  }

  // `message.updated`
  if (payloadType === "message.updated") {
    if (!eventSessionId) {
      countDrop(dropped, "malformed");
      return { matched: false, cursor, events: [] };
    }
    if (eventSessionId !== cursor.remoteSessionId) {
      countDrop(dropped, "sessionMismatch");
      return { matched: false, cursor, events: [] };
    }
    const messageId = asString(props.messageID, "").trim();
    if (!messageId) {
      countDrop(dropped, "malformed");
      return { matched: false, cursor, events: [] };
    }
    const updatedCursor = {
      ...cursor,
      messageId,
      lastEventAt: ts,
    };
    const role = asString(props.role, "").trim() || undefined;
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_updated",
      ts,
      sessionId: eventSessionId,
      messageId,
      ...(role ? { role } : {}),
    };
    return { matched: true, cursor: updatedCursor, events: [event] };
  }

  // `message.part.updated`
  if (payloadType === "message.part.updated") {
    return handlePartUpdated(envelope, cursor, props, eventSessionId, ts, dropped);
  }

  // `message.part.delta`
  if (payloadType === "message.part.delta") {
    return handlePartDelta(cursor, props, eventSessionId, ts, dropped);
  }

  // `message.part.removed`
  if (payloadType === "message.part.removed") {
    return handlePartRemoved(cursor, props, eventSessionId, ts, dropped);
  }

  // Any other event type: ignore if not session-scoped; drop and count
  // if it carried a sessionID that matched (looked session-scoped but
  // unmappable).
  if (eventSessionId && eventSessionId === cursor.remoteSessionId) {
    countDrop(dropped, "unmappable");
  }
  return { matched: false, cursor, events: [] };
}

// ---------------------------------------------------------------------------
// Part handlers
// ---------------------------------------------------------------------------

function handlePartUpdated(
  envelope: OpencodeRemoteGlobalEventEnvelope,
  cursorIn: OpencodeFullRemoteStreamCursor,
  props: Record<string, unknown>,
  eventSessionId: string,
  ts: string,
  dropped: RemoteStreamDroppedEvents,
): CorrelateRemoteEnvelopeResult {
  if (!eventSessionId) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  if (eventSessionId !== cursorIn.remoteSessionId) {
    countDrop(dropped, "sessionMismatch");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  const messageId = asString(props.messageID, "").trim();
  const partObj = parseObject(props.part);
  const partId = asString(partObj.id, "").trim();
  const partType = asString(partObj.type, "").trim();
  if (!messageId || !partId || !partType) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }

  // Check MVP scope
  if (!MVP_PART_TYPES.has(partType)) {
    countDrop(dropped, "unsupportedPartType");
    return { matched: false, cursor: cursorIn, events: [] };
  }

  // Clone mutable cursor fields
  const activePartIds = cursorIn.activePartIds.includes(partId)
    ? [...cursorIn.activePartIds]
    : [...cursorIn.activePartIds, partId];
  const seenPartTypes = { ...cursorIn.seenPartTypes, [partId]: partType };
  const pendingPartDeltas = { ...cursorIn.pendingPartDeltas };
  const reasoningBuffers = { ...cursorIn.reasoningBuffers };

  const events: OpencodeFullRemoteLiveEvent[] = [];

  // Flush any pending deltas for this part that arrived out-of-order
  if (pendingPartDeltas[partId]) {
    const pending = pendingPartDeltas[partId];
    events.push({
      kind: "message_delta",
      ts,
      sessionId: eventSessionId,
      messageId,
      partId,
      field: pending.field,
      delta: pending.delta,
    });
    delete pendingPartDeltas[partId];
  }

  // Emit the part event
  events.push({
    kind: "message_part",
    ts,
    sessionId: eventSessionId,
    messageId,
    partId,
    partType,
    part: envelope.payload.properties,
  });

  const cursor: OpencodeFullRemoteStreamCursor = {
    ...cursorIn,
    messageId,
    activePartIds,
    seenPartTypes,
    pendingPartDeltas,
    reasoningBuffers,
    lastEventAt: ts,
  };
  return { matched: true, cursor, events };
}

function handlePartDelta(
  cursorIn: OpencodeFullRemoteStreamCursor,
  props: Record<string, unknown>,
  eventSessionId: string,
  ts: string,
  dropped: RemoteStreamDroppedEvents,
): CorrelateRemoteEnvelopeResult {
  if (!eventSessionId) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  if (eventSessionId !== cursorIn.remoteSessionId) {
    countDrop(dropped, "sessionMismatch");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  const messageId = asString(props.messageID, "").trim();
  const partId = asString(props.partID, "").trim();
  const field = asString(props.field, "").trim();
  const delta = typeof props.delta === "string" ? props.delta : undefined;
  if (!messageId || !partId || !field || delta === undefined) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }

  // If we know the part type already, emit directly (or buffer for
  // reasoning coalescing).
  const knownType = cursorIn.seenPartTypes[partId];

  if (knownType) {
    // Check MVP scope
    if (!MVP_PART_TYPES.has(knownType)) {
      countDrop(dropped, "unsupportedPartType");
      return { matched: false, cursor: cursorIn, events: [] };
    }

    // For reasoning, we buffer and coalesce (flush happens on
    // message.part.updated or message.updated or explicit flush).
    if (knownType === "reasoning") {
      const reasoningBuffers = { ...cursorIn.reasoningBuffers };
      reasoningBuffers[partId] = (reasoningBuffers[partId] ?? "") + delta;
      const cursor = { ...cursorIn, reasoningBuffers, lastEventAt: ts };
      return { matched: true, cursor, events: [] };
    }

    // For text / tool — emit immediately.
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_delta",
      ts,
      sessionId: eventSessionId,
      messageId,
      partId,
      field,
      delta,
    };
    const cursor = { ...cursorIn, lastEventAt: ts };
    return { matched: true, cursor, events: [event] };
  }

  // Part not yet seen: buffer the delta. Only buffer for MVP-scoped types
  // (we can't know the type yet, so buffer optimistically and drop at
  // resolution if the type turns out to be unsupported).
  const pendingPartDeltas = { ...cursorIn.pendingPartDeltas };

  // Enforce bounded buffer
  const pendingKeys = Object.keys(pendingPartDeltas);
  if (pendingKeys.length >= MAX_PENDING_DELTAS && !pendingPartDeltas[partId]) {
    // Drop the delta and count it
    countDrop(dropped, "bufferOverflow");
    return { matched: false, cursor: cursorIn, events: [] };
  }

  // Append to existing pending for this part, or create a new entry
  if (pendingPartDeltas[partId]) {
    pendingPartDeltas[partId] = {
      field: pendingPartDeltas[partId].field,
      delta: pendingPartDeltas[partId].delta + delta,
    };
  } else {
    pendingPartDeltas[partId] = { field, delta };
  }

  const cursor = { ...cursorIn, pendingPartDeltas, lastEventAt: ts };
  return { matched: true, cursor, events: [] };
}

function handlePartRemoved(
  cursorIn: OpencodeFullRemoteStreamCursor,
  props: Record<string, unknown>,
  eventSessionId: string,
  ts: string,
  dropped: RemoteStreamDroppedEvents,
): CorrelateRemoteEnvelopeResult {
  if (!eventSessionId) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  if (eventSessionId !== cursorIn.remoteSessionId) {
    countDrop(dropped, "sessionMismatch");
    return { matched: false, cursor: cursorIn, events: [] };
  }
  const partId = asString(props.partID, "").trim();
  if (!partId) {
    countDrop(dropped, "malformed");
    return { matched: false, cursor: cursorIn, events: [] };
  }

  // Remove all part-local state. Per design: emit no JSONL because
  // Paperclip has no first-class remove surface in MVP.
  const activePartIds = cursorIn.activePartIds.filter((id) => id !== partId);
  const seenPartTypes = { ...cursorIn.seenPartTypes };
  delete seenPartTypes[partId];
  const pendingPartDeltas = { ...cursorIn.pendingPartDeltas };
  delete pendingPartDeltas[partId];
  const reasoningBuffers = { ...cursorIn.reasoningBuffers };
  delete reasoningBuffers[partId];

  const cursor: OpencodeFullRemoteStreamCursor = {
    ...cursorIn,
    activePartIds,
    seenPartTypes,
    pendingPartDeltas,
    reasoningBuffers,
    lastEventAt: ts,
  };
  // matched true, but no events emitted — cursor mutation only
  return { matched: true, cursor, events: [] };
}

// ---------------------------------------------------------------------------
// JSONL mapper — design §4.3
// ---------------------------------------------------------------------------

export type MapRemoteLiveEventToLogLinesInput = {
  event: OpencodeFullRemoteLiveEvent;
  cursor: OpencodeFullRemoteStreamCursor;
  dropped: RemoteStreamDroppedEvents;
};

/**
 * Map a normalized live event into serialized JSONL strings suitable for
 * `ctx.onLog`. Returns zero or more lines.
 *
 * Reasoning deltas are NOT mapped here — they are coalesced inside the
 * correlator and only flushed on approved boundaries (see
 * `flushReasoningBuffers`).
 */
export function mapRemoteLiveEventToLogLines(
  input: MapRemoteLiveEventToLogLinesInput,
): string[] {
  const { event, dropped } = input;

  switch (event.kind) {
    case "connected": {
      const line: OpencodeFullSyntheticLogLine = {
        type: "step_start",
        sessionID: event.sessionId,
      };
      return [JSON.stringify(line)];
    }

    case "status": {
      const line: OpencodeFullSyntheticLogLine = {
        type: "remote_status",
        sessionID: event.sessionId,
        status: event.status,
      };
      return [JSON.stringify(line)];
    }

    case "message_delta": {
      // Determine part type from cursor
      const partType = input.cursor.seenPartTypes[event.partId];
      if (!partType) {
        // Should not happen after correlator filters, but be defensive.
        countDrop(dropped, "unmappable");
        return [];
      }
      if (partType === "text") {
        const line: OpencodeFullSyntheticLogLine = {
          type: "text",
          part: { text: event.delta },
        };
        return [JSON.stringify(line)];
      }
      // Reasoning deltas should not reach here (coalesced in correlator),
      // but if they do, emit as a reasoning line.
      if (partType === "reasoning") {
        const line: OpencodeFullSyntheticLogLine = {
          type: "reasoning",
          part: { text: event.delta },
        };
        return [JSON.stringify(line)];
      }
      // Tool deltas are not directly mappable to transcript lines.
      // Tool results come from message.part.updated.
      return [];
    }

    case "message_part": {
      if (event.partType === "text") {
        // Part update for text: emit a text line with the final content
        // if available from the part payload.
        const partProps = parseObject(event.part);
        const part = parseObject(partProps.part);
        const stateObj = parseObject(part.state);
        const content = asString(part.content, "").trim() || asString(stateObj.content, "").trim();
        if (content) {
          const line: OpencodeFullSyntheticLogLine = {
            type: "text",
            part: { text: content },
          };
          return [JSON.stringify(line)];
        }
        return [];
      }

      if (event.partType === "reasoning") {
        // Reasoning part updates serve as flush boundaries for the
        // reasoning buffer. The actual flush is performed by the
        // orchestrator calling flushReasoningBuffers — but we don't
        // emit anything directly here from the part event itself.
        return [];
      }

      if (event.partType === "tool") {
        const line: OpencodeFullSyntheticLogLine = {
          type: "tool_use",
          part: event.part,
        };
        return [JSON.stringify(line)];
      }

      countDrop(dropped, "unmappable");
      return [];
    }

    case "message_updated": {
      // Terminal message boundary — no direct JSONL emission. This
      // serves as a flush trigger for reasoning buffers (handled by
      // the orchestrator, not the mapper).
      return [];
    }

    case "session_error": {
      const line: OpencodeFullSyntheticLogLine = {
        type: "error",
        error: event.message,
      };
      return [JSON.stringify(line)];
    }

    case "stream_gap": {
      const line: OpencodeFullSyntheticLogLine = {
        type: "remote_stream_gap",
        sessionID: event.sessionId,
        reason: event.reason,
      };
      return [JSON.stringify(line)];
    }

    default: {
      // Exhaustiveness: if we reach here, the event type is not handled.
      countDrop(dropped, "unmappable");
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Reasoning buffer flush — design §4.3 coalescing
// ---------------------------------------------------------------------------

/**
 * Flush all coalesced reasoning buffers into JSONL lines. This should be
 * called at approved flush boundaries:
 * - On `message.part.updated` for a reasoning part
 * - On terminal `message.updated`
 * - On final flush before reconciliation
 *
 * Returns the JSONL lines and a new cursor with empty reasoning buffers.
 */
export function flushReasoningBuffers(
  cursor: OpencodeFullRemoteStreamCursor,
): { lines: string[]; cursor: OpencodeFullRemoteStreamCursor } {
  const lines: string[] = [];
  for (const [_partId, buffered] of Object.entries(cursor.reasoningBuffers)) {
    if (buffered.length > 0) {
      const line: OpencodeFullSyntheticLogLine = {
        type: "reasoning",
        part: { text: buffered },
      };
      lines.push(JSON.stringify(line));
    }
  }
  return {
    lines,
    cursor: { ...cursor, reasoningBuffers: {} },
  };
}

// ---------------------------------------------------------------------------
// High-level process-envelope helper
// ---------------------------------------------------------------------------

export type ProcessRemoteEnvelopeInput = {
  envelope: OpencodeRemoteGlobalEventEnvelope;
  cursor: OpencodeFullRemoteStreamCursor;
  dropped: RemoteStreamDroppedEvents;
};

export type ProcessRemoteEnvelopeResult = {
  cursor: OpencodeFullRemoteStreamCursor;
  lines: string[];
  events: OpencodeFullRemoteLiveEvent[];
};

/**
 * High-level convenience that combines correlation, mapping, and reasoning
 * flush logic into a single call. Returns updated cursor, JSONL lines for
 * `ctx.onLog`, and normalized events for downstream consumption.
 *
 * Reasoning buffers are flushed when the correlator produces a
 * `message_part` for a reasoning part or a `message_updated` event.
 */
export function processRemoteEnvelope(
  input: ProcessRemoteEnvelopeInput,
): ProcessRemoteEnvelopeResult {
  const { envelope, dropped } = input;
  const correlated = correlateRemoteEnvelope({
    envelope,
    cursor: input.cursor,
    dropped,
  });

  if (!correlated.matched) {
    return { cursor: correlated.cursor, lines: [], events: [] };
  }

  let cursor = correlated.cursor;
  const allLines: string[] = [];
  const allEvents = correlated.events;

  for (const event of correlated.events) {
    const lines = mapRemoteLiveEventToLogLines({
      event,
      cursor,
      dropped,
    });
    allLines.push(...lines);

    // Flush reasoning on approved boundaries
    if (
      (event.kind === "message_part" && event.partType === "reasoning") ||
      event.kind === "message_updated"
    ) {
      const flush = flushReasoningBuffers(cursor);
      allLines.push(...flush.lines);
      cursor = flush.cursor;
    }
  }

  return { cursor, lines: allLines, events: allEvents };
}



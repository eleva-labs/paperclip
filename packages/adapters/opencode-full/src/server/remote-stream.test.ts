import { describe, expect, it } from "vitest";

import {
  createRemoteStreamCursor,
  createRemoteStreamDroppedEvents,
  correlateRemoteEnvelope,
  mapRemoteLiveEventToLogLines,
  flushReasoningBuffers,
  processRemoteEnvelope,
} from "./remote-stream.js";
import type {
  OpencodeRemoteGlobalEventEnvelope,
  OpencodeFullRemoteStreamCursor,
  OpencodeFullRemoteLiveEvent,
} from "./remote-stream-schema.js";
import type { RemoteStreamDroppedEvents } from "./remote-stream.js";
import { parseOpenCodeFullStdoutLine } from "../ui-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envelope(
  directory: string,
  type: string,
  properties?: Record<string, unknown>,
): OpencodeRemoteGlobalEventEnvelope {
  return {
    directory,
    payload: {
      type,
      ...(properties !== undefined ? { properties } : {}),
    },
  };
}

function makeCursor(overrides?: Partial<OpencodeFullRemoteStreamCursor>): OpencodeFullRemoteStreamCursor {
  return {
    ...createRemoteStreamCursor("ses-1", "/linked/dir"),
    ...overrides,
  };
}

function makeDropped(): RemoteStreamDroppedEvents {
  return createRemoteStreamDroppedEvents();
}

// ---------------------------------------------------------------------------
// createRemoteStreamCursor
// ---------------------------------------------------------------------------

describe("createRemoteStreamCursor", () => {
  it("returns a cursor with the expected defaults", () => {
    const cursor = createRemoteStreamCursor("ses-42", "/my/dir");
    expect(cursor.remoteSessionId).toBe("ses-42");
    expect(cursor.linkedDirectoryHint).toBe("/my/dir");
    expect(cursor.messageId).toBeNull();
    expect(cursor.activePartIds).toEqual([]);
    expect(cursor.seenPartTypes).toEqual({});
    expect(cursor.pendingPartDeltas).toEqual({});
    expect(cursor.reasoningBuffers).toEqual({});
    expect(cursor.connectedAt).toBeNull();
    expect(cursor.lastEventAt).toBeNull();
    expect(cursor.degraded).toBe(false);
    expect(cursor.degradeReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Correlator: normative mapping table (design §3.5)
// ---------------------------------------------------------------------------

describe("correlateRemoteEnvelope", () => {
  // ---- server.connected ----

  it("maps server.connected to connected event when directory matches", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "server.connected"),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("connected");
    if (result.events[0].kind === "connected") {
      expect(result.events[0].sessionId).toBe("ses-1");
      expect(result.events[0].directory).toBe("/linked/dir");
    }
    expect(result.cursor.connectedAt).not.toBeNull();
    expect(dropped.total).toBe(0);
  });

  it("ignores server.connected when directory does not match", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/other/dir", "server.connected"),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(dropped.total).toBe(0);
  });

  // ---- session.status ----

  it("maps session.status to status event when directory+session match", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", {
        sessionID: "ses-1",
        status: "running",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("status");
    if (result.events[0].kind === "status") {
      expect(result.events[0].status).toBe("running");
    }
    expect(dropped.total).toBe(0);
  });

  it("counts session.status with mismatched session as dropped (sessionMismatch)", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", {
        sessionID: "ses-WRONG",
        status: "running",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.sessionMismatch).toBe(1);
    expect(dropped.total).toBe(1);
  });

  it("counts session.status with missing sessionID as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", { status: "running" }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.malformed).toBe(1);
  });

  it("counts session.status with missing status field as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", { sessionID: "ses-1" }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.malformed).toBe(1);
  });

  // ---- session.error ----

  it("maps session.error to session_error event", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.error", {
        sessionID: "ses-1",
        error: "out of tokens",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events[0].kind).toBe("session_error");
    if (result.events[0].kind === "session_error") {
      expect(result.events[0].message).toBe("out of tokens");
    }
    expect(dropped.total).toBe(0);
  });

  it("maps session.error with message field when error is missing", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.error", {
        sessionID: "ses-1",
        message: "rate limit exceeded",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    if (result.events[0].kind === "session_error") {
      expect(result.events[0].message).toBe("rate limit exceeded");
    }
  });

  // ---- message.updated ----

  it("maps message.updated to message_updated and caches messageId", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        role: "assistant",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.cursor.messageId).toBe("msg-1");
    expect(result.events[0].kind).toBe("message_updated");
    if (result.events[0].kind === "message_updated") {
      expect(result.events[0].role).toBe("assistant");
    }
    expect(dropped.total).toBe(0);
  });

  it("counts message.updated with missing messageID as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.updated", { sessionID: "ses-1" }),
      cursor,
      dropped,
    });
    expect(dropped.malformed).toBe(1);
  });

  // ---- message.part.updated ----

  it("maps message.part.updated for text part to message_part", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-1", type: "text", content: "hello world" },
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("message_part");
    expect(result.cursor.activePartIds).toContain("p-1");
    expect(result.cursor.seenPartTypes["p-1"]).toBe("text");
    expect(dropped.total).toBe(0);
  });

  it("maps message.part.updated for tool part to message_part", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-2", type: "tool", tool: "bash", state: { input: {} } },
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events[0].kind).toBe("message_part");
    if (result.events[0].kind === "message_part") {
      expect(result.events[0].partType).toBe("tool");
    }
  });

  it("drops message.part.updated for unsupported part types and counts them", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-3", type: "file" },
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.unsupportedPartType).toBe(1);
  });

  it("counts message.part.updated with missing part metadata as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        // missing part entirely
      }),
      cursor,
      dropped,
    });
    expect(dropped.malformed).toBe(1);
  });

  // ---- message.part.delta ----

  it("maps message.part.delta for a known text part immediately", () => {
    const cursor = makeCursor({
      seenPartTypes: { "p-1": "text" },
      activePartIds: ["p-1"],
    });
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-1",
        field: "content",
        delta: "hello",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe("message_delta");
    if (result.events[0].kind === "message_delta") {
      expect(result.events[0].delta).toBe("hello");
    }
    expect(dropped.total).toBe(0);
  });

  it("buffers reasoning deltas instead of emitting immediately", () => {
    const cursor = makeCursor({
      seenPartTypes: { "p-r": "reasoning" },
      activePartIds: ["p-r"],
    });
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-r",
        field: "reasoning",
        delta: "thinking...",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    // No events emitted for coalesced reasoning
    expect(result.events).toHaveLength(0);
    expect(result.cursor.reasoningBuffers["p-r"]).toBe("thinking...");
    expect(dropped.total).toBe(0);
  });

  it("coalesces multiple reasoning deltas in buffer", () => {
    const cursor = makeCursor({
      seenPartTypes: { "p-r": "reasoning" },
      activePartIds: ["p-r"],
      reasoningBuffers: { "p-r": "first " },
    });
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-r",
        field: "reasoning",
        delta: "second",
      }),
      cursor,
      dropped,
    });
    expect(result.cursor.reasoningBuffers["p-r"]).toBe("first second");
  });

  // ---- out-of-order delta buffering ----

  it("buffers deltas for unknown parts and flushes on part.updated", () => {
    let cursor = makeCursor();
    const dropped = makeDropped();

    // Delta arrives before part.updated
    const delta1 = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-new",
        field: "content",
        delta: "buffered-text",
      }),
      cursor,
      dropped,
    });
    expect(delta1.matched).toBe(true);
    expect(delta1.events).toHaveLength(0);
    expect(delta1.cursor.pendingPartDeltas["p-new"]).toEqual({
      field: "content",
      delta: "buffered-text",
    });
    cursor = delta1.cursor;

    // Now part.updated arrives — should flush the pending delta first
    const partUp = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-new", type: "text", content: "full" },
      }),
      cursor,
      dropped,
    });
    expect(partUp.matched).toBe(true);
    // Should have both the flushed delta and the part event
    expect(partUp.events).toHaveLength(2);
    expect(partUp.events[0].kind).toBe("message_delta");
    expect(partUp.events[1].kind).toBe("message_part");
    // Pending buffer should be cleared
    expect(partUp.cursor.pendingPartDeltas["p-new"]).toBeUndefined();
    expect(dropped.total).toBe(0);
  });

  it("appends multiple out-of-order deltas for the same part", () => {
    let cursor = makeCursor();
    const dropped = makeDropped();

    cursor = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-new",
        field: "content",
        delta: "aaa",
      }),
      cursor,
      dropped,
    }).cursor;

    cursor = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-new",
        field: "content",
        delta: "bbb",
      }),
      cursor,
      dropped,
    }).cursor;

    expect(cursor.pendingPartDeltas["p-new"]?.delta).toBe("aaabbb");
  });

  it("drops deltas when the pending buffer is full (bounded)", () => {
    // Pre-fill 64 pending entries
    const pendingPartDeltas: Record<string, { field: string; delta: string }> = {};
    for (let i = 0; i < 64; i++) {
      pendingPartDeltas[`part-${i}`] = { field: "content", delta: `d-${i}` };
    }
    const cursor = makeCursor({ pendingPartDeltas });
    const dropped = makeDropped();

    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "part-overflow",
        field: "content",
        delta: "overflow",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.bufferOverflow).toBe(1);
    expect(dropped.total).toBe(1);
  });

  it("allows appending to an existing pending entry even when buffer is at capacity", () => {
    const pendingPartDeltas: Record<string, { field: string; delta: string }> = {};
    for (let i = 0; i < 64; i++) {
      pendingPartDeltas[`part-${i}`] = { field: "content", delta: `d-${i}` };
    }
    const cursor = makeCursor({ pendingPartDeltas });
    const dropped = makeDropped();

    // Append to an existing pending entry
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "part-0",
        field: "content",
        delta: "-extra",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.cursor.pendingPartDeltas["part-0"]?.delta).toBe("d-0-extra");
    expect(dropped.total).toBe(0);
  });

  it("counts delta with missing fields as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.delta", {
        sessionID: "ses-1",
        messageID: "msg-1",
        // missing partID, field, delta
      }),
      cursor,
      dropped,
    });
    expect(dropped.malformed).toBe(1);
  });

  // ---- message.part.removed ----

  it("removes part-local state on message.part.removed", () => {
    const cursor = makeCursor({
      activePartIds: ["p-1", "p-2"],
      seenPartTypes: { "p-1": "text", "p-2": "reasoning" },
      pendingPartDeltas: { "p-1": { field: "content", delta: "pending" } },
      reasoningBuffers: { "p-2": "buffered-reasoning" },
    });
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.removed", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-1",
      }),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(true);
    expect(result.events).toHaveLength(0); // No JSONL for removes
    expect(result.cursor.activePartIds).toEqual(["p-2"]);
    expect(result.cursor.seenPartTypes["p-1"]).toBeUndefined();
    expect(result.cursor.pendingPartDeltas["p-1"]).toBeUndefined();
    // p-2 state should be preserved
    expect(result.cursor.seenPartTypes["p-2"]).toBe("reasoning");
    expect(result.cursor.reasoningBuffers["p-2"]).toBe("buffered-reasoning");
    expect(dropped.total).toBe(0);
  });

  it("removes reasoning buffer on message.part.removed for reasoning part", () => {
    const cursor = makeCursor({
      activePartIds: ["p-r"],
      seenPartTypes: { "p-r": "reasoning" },
      reasoningBuffers: { "p-r": "some reasoning" },
    });
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.removed", {
        sessionID: "ses-1",
        messageID: "msg-1",
        partID: "p-r",
      }),
      cursor,
      dropped,
    });
    expect(result.cursor.reasoningBuffers["p-r"]).toBeUndefined();
    expect(result.cursor.activePartIds).toEqual([]);
  });

  it("counts message.part.removed with missing partID as malformed", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.removed", {
        sessionID: "ses-1",
        messageID: "msg-1",
      }),
      cursor,
      dropped,
    });
    expect(dropped.malformed).toBe(1);
  });

  // ---- unknown/other event types ----

  it("ignores unknown event types without session binding silently", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "some.custom.event"),
      cursor,
      dropped,
    });
    expect(result.matched).toBe(false);
    expect(dropped.total).toBe(0);
  });

  it("counts unknown event types with matching session as unmappable", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "some.custom.event", {
        sessionID: "ses-1",
      }),
      cursor,
      dropped,
    });
    expect(dropped.unmappable).toBe(1);
  });

  // ---- directory mismatch ----

  it("ignores all events with wrong directory without counting", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    correlateRemoteEnvelope({
      envelope: envelope("/wrong/dir", "session.status", {
        sessionID: "ses-1",
        status: "running",
      }),
      cursor,
      dropped,
    });
    expect(dropped.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// JSONL mapper
// ---------------------------------------------------------------------------

describe("mapRemoteLiveEventToLogLines", () => {
  it("maps connected event to step_start JSONL", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "connected",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      directory: "/linked/dir",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("step_start");
    expect(parsed.sessionID).toBe("ses-1");
  });

  it("maps status event to remote_status JSONL", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "status",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      status: "running",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("remote_status");
    expect(parsed.status).toBe("running");
    expect(parsed.sessionID).toBe("ses-1");
  });

  it("maps text message_delta to text JSONL", () => {
    const cursor = makeCursor({ seenPartTypes: { "p-1": "text" } });
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_delta",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      messageId: "msg-1",
      partId: "p-1",
      field: "content",
      delta: "hello",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("text");
    expect(parsed.part.text).toBe("hello");
  });

  it("maps tool message_part to tool_use JSONL", () => {
    const cursor = makeCursor({ seenPartTypes: { "p-t": "tool" } });
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_part",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      messageId: "msg-1",
      partId: "p-t",
      partType: "tool",
      part: { tool: "bash", state: { input: { command: "ls" } } },
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("tool_use");
  });

  it("maps session_error to error JSONL", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "session_error",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      message: "context overflow",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("context overflow");
  });

  it("maps stream_gap to remote_stream_gap JSONL", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "stream_gap",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      reason: "transport disconnected",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe("remote_stream_gap");
    expect(parsed.reason).toBe("transport disconnected");
  });

  it("emits no lines for message_updated (flush boundary only)", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_updated",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      messageId: "msg-1",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(0);
  });

  it("counts unmappable delta (unknown part) via dropped surface", () => {
    const cursor = makeCursor(); // no seenPartTypes
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_delta",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      messageId: "msg-1",
      partId: "p-unknown",
      field: "content",
      delta: "data",
    };
    const lines = mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(lines).toHaveLength(0);
    expect(dropped.unmappable).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reasoning buffer flush
// ---------------------------------------------------------------------------

describe("flushReasoningBuffers", () => {
  it("emits reasoning JSONL for all non-empty buffers and clears them", () => {
    const cursor = makeCursor({
      reasoningBuffers: {
        "p-r1": "first thought",
        "p-r2": "second thought",
        "p-r3": "", // empty — should not produce a line
      },
    });
    const { lines, cursor: newCursor } = flushReasoningBuffers(cursor);
    expect(lines).toHaveLength(2);
    const texts = lines.map((l) => JSON.parse(l).part.text).sort();
    expect(texts).toEqual(["first thought", "second thought"]);
    expect(newCursor.reasoningBuffers).toEqual({});
  });

  it("returns empty lines when no reasoning buffers exist", () => {
    const cursor = makeCursor();
    const { lines, cursor: newCursor } = flushReasoningBuffers(cursor);
    expect(lines).toHaveLength(0);
    expect(newCursor.reasoningBuffers).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// processRemoteEnvelope (integration)
// ---------------------------------------------------------------------------

describe("processRemoteEnvelope", () => {
  it("produces step_start JSONL for server.connected", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = processRemoteEnvelope({
      envelope: envelope("/linked/dir", "server.connected"),
      cursor,
      dropped,
    });
    expect(result.lines).toHaveLength(1);
    expect(JSON.parse(result.lines[0]).type).toBe("step_start");
    expect(result.events).toHaveLength(1);
  });

  it("produces remote_status JSONL for session.status", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = processRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", {
        sessionID: "ses-1",
        status: "idle",
      }),
      cursor,
      dropped,
    });
    expect(result.lines).toHaveLength(1);
    expect(JSON.parse(result.lines[0]).type).toBe("remote_status");
  });

  it("flushes reasoning buffer on message.updated", () => {
    const cursor = makeCursor({
      reasoningBuffers: { "p-r": "accumulated reasoning" },
    });
    const dropped = makeDropped();
    const result = processRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
      }),
      cursor,
      dropped,
    });
    // message_updated produces no direct JSONL, but flushes reasoning
    expect(result.lines).toHaveLength(1);
    const parsed = JSON.parse(result.lines[0]);
    expect(parsed.type).toBe("reasoning");
    expect(parsed.part.text).toBe("accumulated reasoning");
    expect(result.cursor.reasoningBuffers).toEqual({});
  });

  it("flushes reasoning buffer on message.part.updated for reasoning part", () => {
    const cursor = makeCursor({
      seenPartTypes: { "p-r": "reasoning" },
      activePartIds: ["p-r"],
      reasoningBuffers: { "p-r": "coalesced" },
    });
    const dropped = makeDropped();
    const result = processRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-r", type: "reasoning" },
      }),
      cursor,
      dropped,
    });
    // Should have the flushed reasoning line
    const reasoningLines = result.lines.filter((l) => JSON.parse(l).type === "reasoning");
    expect(reasoningLines).toHaveLength(1);
    expect(JSON.parse(reasoningLines[0]).part.text).toBe("coalesced");
  });

  it("returns empty lines for ignored envelopes", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();
    const result = processRemoteEnvelope({
      envelope: envelope("/wrong/dir", "session.status", {
        sessionID: "ses-1",
        status: "running",
      }),
      cursor,
      dropped,
    });
    expect(result.lines).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remoteStreamDroppedEvents accumulation
// ---------------------------------------------------------------------------

describe("remoteStreamDroppedEvents accumulation", () => {
  it("accumulates drops across multiple correlations sharing the same surface", () => {
    const cursor = makeCursor();
    const dropped = makeDropped();

    // Malformed status
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", { sessionID: "ses-1" }),
      cursor,
      dropped,
    });
    // Session mismatch
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "session.status", {
        sessionID: "ses-wrong",
        status: "running",
      }),
      cursor,
      dropped,
    });
    // Unsupported part type
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "message.part.updated", {
        sessionID: "ses-1",
        messageID: "msg-1",
        part: { id: "p-x", type: "diff" },
      }),
      cursor,
      dropped,
    });
    // Unmappable
    correlateRemoteEnvelope({
      envelope: envelope("/linked/dir", "custom.event", { sessionID: "ses-1" }),
      cursor,
      dropped,
    });

    expect(dropped.total).toBe(4);
    expect(dropped.malformed).toBe(1);
    expect(dropped.sessionMismatch).toBe(1);
    expect(dropped.unsupportedPartType).toBe(1);
    expect(dropped.unmappable).toBe(1);
    expect(dropped.bufferOverflow).toBe(0);
  });

  it("accumulates dropped events from mapper path as well", () => {
    const cursor = makeCursor(); // no seenPartTypes
    const dropped = makeDropped();
    const event: OpencodeFullRemoteLiveEvent = {
      kind: "message_delta",
      ts: "2026-01-01T00:00:00.000Z",
      sessionId: "ses-1",
      messageId: "msg-1",
      partId: "unknown-part",
      field: "content",
      delta: "text",
    };
    mapRemoteLiveEventToLogLines({ event, cursor, dropped });
    expect(dropped.unmappable).toBe(1);
    expect(dropped.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ui-parser.ts compatibility for remote JSONL types
// ---------------------------------------------------------------------------

describe("parseOpenCodeFullStdoutLine — remote JSONL types", () => {
  it("parses remote_status into a system entry", () => {
    const line = JSON.stringify({
      type: "remote_status",
      sessionID: "ses-1",
      status: "running",
    });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect((entries[0] as { text: string }).text).toContain("ses-1");
    expect((entries[0] as { text: string }).text).toContain("running");
  });

  it("parses remote_status without sessionID gracefully", () => {
    const line = JSON.stringify({
      type: "remote_status",
      status: "idle",
    });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect((entries[0] as { text: string }).text).toContain("idle");
  });

  it("parses remote_stream_gap into a system entry", () => {
    const line = JSON.stringify({
      type: "remote_stream_gap",
      sessionID: "ses-1",
      reason: "transport disconnected",
    });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect((entries[0] as { text: string }).text).toContain("transport disconnected");
    expect((entries[0] as { text: string }).text).toContain("ses-1");
  });

  it("parses remote_stream_gap without sessionID gracefully", () => {
    const line = JSON.stringify({
      type: "remote_stream_gap",
      reason: "network error",
    });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect((entries[0] as { text: string }).text).toContain("network error");
  });

  it("does not break existing text parsing", () => {
    const line = JSON.stringify({ type: "text", part: { text: "hello world" } });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("assistant");
  });

  it("does not break existing error parsing", () => {
    const line = JSON.stringify({ type: "error", error: "something broke" });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stderr");
  });

  it("does not break existing step_start parsing", () => {
    const line = JSON.stringify({ type: "step_start", sessionID: "ses-1" });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
  });

  it("does not break existing reasoning parsing", () => {
    const line = JSON.stringify({ type: "reasoning", part: { text: "thinking about it" } });
    const entries = parseOpenCodeFullStdoutLine(line, "2026-01-01T00:00:00Z");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("thinking");
  });
});

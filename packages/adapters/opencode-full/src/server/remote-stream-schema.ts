import { z } from "zod";

// 3.1 — Remote global event envelope received from GET /global/event
export const opencodeRemoteGlobalPayloadSchema = z
  .object({
    type: z.string().min(1),
    properties: z.unknown().optional(),
  })
  .strict();

export const opencodeRemoteGlobalEventEnvelopeSchema = z
  .object({
    directory: z.string().min(1),
    project: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    payload: opencodeRemoteGlobalPayloadSchema,
  })
  .strict();

export type OpencodeRemoteGlobalPayload = z.infer<typeof opencodeRemoteGlobalPayloadSchema>;
export type OpencodeRemoteGlobalEventEnvelope = z.infer<
  typeof opencodeRemoteGlobalEventEnvelopeSchema
>;

// 3.2 — Correlation cursor maintained by the stream layer for an active run
export const opencodeFullRemoteStreamCursorSchema = z
  .object({
    remoteSessionId: z.string().min(1),
    linkedDirectoryHint: z.string().min(1),
    messageId: z.string().min(1).nullable().default(null),
    activePartIds: z.array(z.string().min(1)).default([]),
    seenPartTypes: z.record(z.string().min(1), z.string().min(1)).default({}),
    pendingPartDeltas: z
      .record(
        z.string().min(1),
        z
          .object({
            field: z.string().min(1),
            delta: z.string(),
          })
          .strict(),
      )
      .default({}),
    reasoningBuffers: z.record(z.string().min(1), z.string()).default({}),
    connectedAt: z.string().datetime().nullable().default(null),
    lastEventAt: z.string().datetime().nullable().default(null),
    degraded: z.boolean().default(false),
    degradeReason: z.string().min(1).nullable().default(null),
  })
  .strict();

export type OpencodeFullRemoteStreamCursor = z.infer<typeof opencodeFullRemoteStreamCursorSchema>;

// 3.3 — Normalized internal live-event discriminated union
export const opencodeFullRemoteLiveEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("connected"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      directory: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("status"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      status: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message_delta"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      messageId: z.string().min(1),
      partId: z.string().min(1),
      field: z.string().min(1),
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message_part"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      messageId: z.string().min(1),
      partId: z.string().min(1),
      partType: z.string().min(1),
      part: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("message_updated"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      messageId: z.string().min(1),
      role: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session_error"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      message: z.string().min(1),
      raw: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stream_gap"),
      ts: z.string().datetime(),
      sessionId: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
]);

export type OpencodeFullRemoteLiveEvent = z.infer<typeof opencodeFullRemoteLiveEventSchema>;

// 3.4 — Synthetic JSONL line envelope emitted into ctx.onLog
export const opencodeFullSyntheticLogLineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      part: z.object({ text: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      part: z.object({ text: z.string() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool_use"),
      part: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step_start"),
      sessionID: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("step_finish"),
      part: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      error: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remote_status"),
      sessionID: z.string().min(1),
      status: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("remote_stream_gap"),
      sessionID: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
]);

export type OpencodeFullSyntheticLogLine = z.infer<typeof opencodeFullSyntheticLogLineSchema>;

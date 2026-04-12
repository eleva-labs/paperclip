import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return "";
  const data = asRecord(record.data);
  return asString(record.message) || asString(data?.message) || asString(record.name) || "";
}

export function parseOpenCodeFullStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) return [{ kind: "stdout", ts, text: line }];

  const type = asString(parsed.type);
  if (type === "text") {
    const part = asRecord(parsed.part);
    const text = asString(part?.text).trim();
    return text ? [{ kind: "assistant", ts, text }] : [];
  }

  if (type === "reasoning") {
    const part = asRecord(parsed.part);
    const text = asString(part?.text).trim();
    return text ? [{ kind: "thinking", ts, text }] : [];
  }

  if (type === "step_finish") {
    const part = asRecord(parsed.part);
    const tokens = asRecord(part?.tokens);
    const cache = asRecord(tokens?.cache);
    const reason = asString(part?.reason, "step");
    return [{
      kind: "result",
      ts,
      text: reason,
      inputTokens: asNumber(tokens?.input, 0),
      outputTokens: asNumber(tokens?.output, 0) + asNumber(tokens?.reasoning, 0),
      cachedTokens: asNumber(cache?.read, 0),
      costUsd: asNumber(part?.cost, 0),
      subtype: reason,
      isError: false,
      errors: [],
    }];
  }

  if (type === "error") {
    return [{ kind: "stderr", ts, text: errorText(parsed.error ?? parsed.message) || line }];
  }

  return [{ kind: "stdout", ts, text: line }];
}

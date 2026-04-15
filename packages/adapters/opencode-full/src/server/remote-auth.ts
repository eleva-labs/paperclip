import { opencodeFullRemoteAuthPersistedSchema } from "./config-schema.js";
import { opencodeFullRemoteAuthRuntimeSchema } from "./runtime-schema.js";

export { opencodeFullRemoteAuthPersistedSchema, opencodeFullRemoteAuthRuntimeSchema };

export type RemoteAuthCheckResult =
  | { ok: true; auth: ReturnType<typeof opencodeFullRemoteAuthRuntimeSchema.parse> }
  | { ok: false; reason: string };

export function isResolvedRemoteAuth(rawAuth: unknown): boolean {
  return opencodeFullRemoteAuthRuntimeSchema.safeParse(rawAuth).success;
}

export function buildRemoteAuthHeaders(rawAuth: unknown): Record<string, string> {
  const auth = opencodeFullRemoteAuthRuntimeSchema.parse(rawAuth);

  switch (auth.mode) {
    case "none":
      return {};
    case "bearer":
      return { Authorization: `Bearer ${auth.token}` };
    case "basic": {
      const token = Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64");
      return { Authorization: `Basic ${token}` };
    }
    case "header":
      return { [auth.headerName]: auth.headerValue };
  }

  return {};
}

export function validateResolvedRemoteAuth(rawAuth: unknown): RemoteAuthCheckResult {
  const parsed = opencodeFullRemoteAuthRuntimeSchema.safeParse(rawAuth);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "Remote auth must be runtime-resolved before it reaches opencode_full remote_server execution/testing.",
    };
  }

  if (parsed.data.mode !== "none") {
    return {
      ok: false,
      reason: "MVP remote execution currently supports only auth.mode=none; other auth branches remain schema placeholders.",
    };
  }

  return { ok: true, auth: parsed.data };
}

export function describePersistedRemoteAuth(rawAuth: unknown): string {
  const auth = opencodeFullRemoteAuthPersistedSchema.parse(rawAuth);
  switch (auth.mode) {
    case "none":
      return "No remote auth";
    case "bearer":
      return "Bearer token via Paperclip secret-capable binding";
    case "basic":
      return `Basic auth for ${auth.username}`;
    case "header":
      return `Custom header auth via ${auth.headerName}`;
  }

  return "Unknown remote auth";
}

import { opencodeFullRemoteAuthPersistedSchema, opencodeFullRemoteAuthRuntimeSchema } from "./config-schema.js";

export { opencodeFullRemoteAuthPersistedSchema, opencodeFullRemoteAuthRuntimeSchema };

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

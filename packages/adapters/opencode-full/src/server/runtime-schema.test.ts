import { describe, expect, it } from "vitest";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";

describe("opencodeFull runtime schema", () => {
  it("accepts resolved runtime auth values for remote_server", () => {
    const parsed = opencodeFullRuntimeConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "basic", username: "forgebox", password: "resolved-password" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });

    expect(parsed.executionMode).toBe("remote_server");
    if (parsed.executionMode !== "remote_server") {
      throw new Error("expected remote_server runtime config");
    }

    expect(parsed.remoteServer.auth.mode).toBe("basic");
  });

  it("accepts linked_project_context only when runtime linkRef is present", () => {
    const success = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "linked_project_context" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/tmp/forgebox",
          serverScope: "shared",
          validatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    const missingLinkRef = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "linked_project_context" },
      },
    });

    const extraLinkRef = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/tmp/forgebox",
          serverScope: "shared",
          validatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    });

    expect(success.success).toBe(true);
    expect(missingLinkRef.success).toBe(false);
    expect(extraLinkRef.success).toBe(false);
  });

  it("rejects persisted secret-ref objects in remote auth at runtime", () => {
    const result = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: {
          mode: "bearer",
          token: {
            type: "secret_ref",
            secretId: "11111111-1111-4111-8111-111111111111",
          },
        },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects secret binding objects crossing into local runtime env", () => {
    const result = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "local_cli",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      localCli: {
        command: "opencode",
        allowProjectConfig: true,
        dangerouslySkipPermissions: false,
        graceSec: 5,
        env: {
          OPENAI_API_KEY: {
            type: "secret_ref",
            secretId: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects endpoint-specific remote base URLs at runtime", () => {
    const result = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com/session",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });

    expect(result.success).toBe(false);
  });

  it("preserves reverse-proxy runtime base paths that only happen to include endpoint words", () => {
    const result = opencodeFullRuntimeConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com/proxy/provider",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });

    expect(result.success).toBe(true);
  });
});

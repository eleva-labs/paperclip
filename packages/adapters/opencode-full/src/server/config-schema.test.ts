import { describe, expect, it } from "vitest";
import {
  getOpencodeFullConfigSchema,
  opencodeFullPersistedConfigSchema,
} from "./config-schema.js";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";

describe("opencodeFull config schemas", () => {
  it("accepts secret-capable persisted remote auth and keeps persisted/runtime shapes distinct", () => {
    const persisted = opencodeFullPersistedConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: {
          mode: "bearer",
          token: {
            type: "secret_ref",
            secretId: "11111111-1111-4111-8111-111111111111",
            version: "latest",
          },
        },
      },
    });

    expect(persisted.executionMode).toBe("remote_server");
    if (persisted.executionMode !== "remote_server") {
      throw new Error("expected remote_server persisted config");
    }

    expect(persisted.remoteServer.auth).toEqual({
      mode: "bearer",
      token: {
        type: "secret_ref",
        secretId: "11111111-1111-4111-8111-111111111111",
        version: "latest",
      },
    });

    const runtime = opencodeFullRuntimeConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "bearer", token: "resolved-token" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });

    expect(runtime.executionMode).toBe("remote_server");
    if (runtime.executionMode !== "remote_server") {
      throw new Error("expected remote_server runtime config");
    }

    expect(runtime.remoteServer.auth).toEqual({ mode: "bearer", token: "resolved-token" });
  });

  it("keeps local_sdk as a deferred schema branch only", () => {
    const parsed = opencodeFullPersistedConfigSchema.parse({
      executionMode: "local_sdk",
      model: "openai/gpt-5.4",
      localSdk: {},
    });

    expect(parsed.executionMode).toBe("local_sdk");
    expect(parsed).toHaveProperty("localSdk");
    expect(parsed).not.toHaveProperty("localCli");
    expect(parsed).not.toHaveProperty("remoteServer");
  });

  it("accepts linked_project_context only when plugin-derived linkRef is present", () => {
    const success = opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
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

    const missingLinkRef = opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        projectTarget: { mode: "linked_project_context" },
      },
    });

    const extraLinkRef = opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
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

  it("rejects endpoint-specific remote base URLs while preserving server base paths", () => {
    expect(opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com/global/health",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    }).success).toBe(false);

    expect(opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com/proxy/session",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    }).success).toBe(true);

    expect(opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com/proxy/opencode",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    }).success).toBe(true);

    expect(opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com/session/abc/message",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    }).success).toBe(false);
  });

  it("keeps non-none auth branches as persisted schema placeholders", () => {
    const parsed = opencodeFullPersistedConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: {
          mode: "header",
          headerName: "X-API-Key",
          headerValue: {
            type: "secret_ref",
            secretId: "11111111-1111-4111-8111-111111111111",
            version: "latest",
          },
        },
      },
    });

    expect(parsed.executionMode).toBe("remote_server");
    if (parsed.executionMode !== "remote_server") {
      throw new Error("expected remote_server persisted config");
    }

    expect(parsed.remoteServer.auth.mode).toBe("header");
  });

  it("keeps mode-specific config fields explicit in the config schema surface", () => {
    const schema = getOpencodeFullConfigSchema();
    const keys = schema.fields.map((field: { key: string }) => field.key);

    expect(keys).toEqual(expect.arrayContaining([
      "executionMode",
      "localCli.command",
      "remoteServer.baseUrl",
      "remoteServer.auth.mode",
      "remoteServer.auth.token",
      "remoteServer.auth",
        "remoteServer.projectTarget.mode",
        "remoteServer.projectTarget",
        "remoteServer.linkRef",
        "localSdk.sdkProviderHint",
      ]));
  });

  it("rejects unresolved secret-binding objects in the runtime schema", () => {
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
});

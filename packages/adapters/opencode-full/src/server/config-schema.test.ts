import { describe, expect, it } from "vitest";
import type { AdapterEnvironmentCheck } from "@paperclipai/adapter-utils";
import {
  getOpencodeFullConfigSchema,
  opencodeFullPersistedConfigSchema,
  opencodeFullRuntimeConfigSchema,
} from "./config-schema.js";
import { testEnvironment } from "./index.js";

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
        projectTarget: { mode: "server_default", requireDedicatedServer: false },
      },
    });

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

  it("keeps mode-specific config fields explicit in the config schema surface", () => {
    const schema = getOpencodeFullConfigSchema();
    const keys = schema.fields.map((field: { key: string }) => field.key);

    expect(keys).toEqual(expect.arrayContaining([
      "executionMode",
      "localCli.command",
      "remoteServer.baseUrl",
      "remoteServer.auth",
      "remoteServer.projectTarget",
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
        projectTarget: { mode: "server_default", requireDedicatedServer: false },
      },
    });

    expect(result.success).toBe(false);
  });

  it("reports remote target readiness truthfully in config-only environment checks", async () => {
    const serverDefault = await testEnvironment({
      companyId: "company-1",
      adapterType: "opencode_full",
      config: {
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
          projectTarget: { mode: "server_default", requireDedicatedServer: false },
        },
      },
    });

    expect(serverDefault.status).toBe("pass");
    expect(serverDefault.checks.map((check: AdapterEnvironmentCheck) => check.code)).toEqual(expect.arrayContaining([
      "opencode_runtime_target_resolved",
    ]));

    const deferred = await testEnvironment({
      companyId: "company-1",
      adapterType: "opencode_full",
      config: {
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
          projectTarget: {
            mode: "paperclip_workspace",
            requireDedicatedServer: false,
          },
        },
      },
    });

    expect(deferred.status).toBe("warn");
    expect(deferred.checks.map((check: AdapterEnvironmentCheck) => check.code)).toEqual(expect.arrayContaining([
      "opencode_runtime_target_unsupported",
    ]));

    const unsupported = await testEnvironment({
      companyId: "company-1",
      adapterType: "opencode_full",
      config: {
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
          projectTarget: {
            mode: "fixed_path",
            projectPath: "/srv/opencode/company-a",
            requireDedicatedServer: true,
          },
        },
      },
    });

    expect(unsupported.status).toBe("fail");
    expect(unsupported.checks.map((check: AdapterEnvironmentCheck) => check.code)).toEqual(expect.arrayContaining([
      "opencode_runtime_target_unsupported",
    ]));
  });
});

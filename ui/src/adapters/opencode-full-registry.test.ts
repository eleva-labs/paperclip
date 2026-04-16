import { describe, expect, it } from "vitest";
import { getUIAdapter } from "./registry";
import { SchemaConfigFields } from "./schema-config-fields";
import {
  buildOpenCodeFullConfig,
  DEFAULT_OPENCODE_FULL_MODEL,
} from "../../../packages/adapters/opencode-full/src/ui/index";

describe("opencode_full UI adapter registry", () => {
  it("uses the schema-backed opencode_full config builder", () => {
    const adapter = getUIAdapter("opencode_full");

    expect(adapter.ConfigFields).toBe(SchemaConfigFields);
    expect(adapter.buildAdapterConfig).toBe(buildOpenCodeFullConfig);

    expect(
      adapter.buildAdapterConfig({
        adapterType: "opencode_full",
        cwd: "",
        instructionsFilePath: "",
        promptTemplate: "",
        model: "openai/gpt-5.4",
        thinkingEffort: "",
        chrome: false,
        dangerouslySkipPermissions: false,
        search: false,
        fastMode: false,
        dangerouslyBypassSandbox: false,
        command: "",
        args: "",
        extraArgs: "",
        envVars: "",
        envBindings: {},
        url: "",
        bootstrapPrompt: "",
        payloadTemplateJson: "",
        workspaceStrategyType: "project_primary",
        workspaceBaseRef: "",
        workspaceBranchTemplate: "",
        worktreeParentDir: "",
        runtimeServicesJson: "",
        maxTurnsPerRun: 1000,
        heartbeatEnabled: false,
        intervalSec: 300,
        adapterSchemaValues: {
          executionMode: "remote_server",
          "remoteServer.baseUrl": "https://example.com/opencode",
          "remoteServer.auth.mode": "none",
        },
      }),
    ).toEqual({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://example.com/opencode",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "server_default" },
      },
    });
  });

  it("builds onboarding-safe local_cli config with required defaults", () => {
    const adapter = getUIAdapter("opencode_full");

    expect(
      adapter.buildAdapterConfig({
        adapterType: "opencode_full",
        cwd: "",
        instructionsFilePath: "",
        promptTemplate: "",
        model: "openai/gpt-5.4",
        thinkingEffort: "",
        chrome: false,
        dangerouslySkipPermissions: false,
        search: false,
        fastMode: false,
        dangerouslyBypassSandbox: false,
        command: "",
        args: "",
        extraArgs: "",
        envVars: "",
        envBindings: {},
        url: "",
        bootstrapPrompt: "",
        payloadTemplateJson: "",
        workspaceStrategyType: "project_primary",
        workspaceBaseRef: "",
        workspaceBranchTemplate: "",
        worktreeParentDir: "",
        runtimeServicesJson: "",
        maxTurnsPerRun: 1000,
        heartbeatEnabled: false,
        intervalSec: 300,
      }),
    ).toEqual({
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
        env: {},
      },
    });
  });

  it("exposes the default model from the UI-safe surface", () => {
    expect(DEFAULT_OPENCODE_FULL_MODEL).toBe("openai/gpt-5.4");
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { buildOpenCodeFullConfig } from "../../../packages/adapters/opencode-full/src/ui/index";
import {
  getOpencodeFullConfigSchema,
  opencodeFullPersistedConfigSchema,
} from "../../../packages/adapters/opencode-full/src/server/config-schema";
import { adaptersApi } from "../api/adapters";
import type { AdapterConfigSchemaResponse } from "../api/adapters";
import { TooltipProvider } from "../components/ui/tooltip";
import { SchemaConfigFields } from "./schema-config-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/adapters", () => ({
  adaptersApi: {
    configSchema: vi.fn(),
  },
}));

const opencodeFullSchemaResponse: AdapterConfigSchemaResponse = getOpencodeFullConfigSchema();

async function flushRender() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("opencode_full remote fields", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(adaptersApi.configSchema).mockResolvedValue(opencodeFullSchemaResponse);
  });

  afterEach(() => {
    container.remove();
  });

  it("serializes first-class remote fields into the persisted happy-path shape", () => {
    const config = buildOpenCodeFullConfig({
      adapterType: "opencode_full",
      cwd: "",
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
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://gateway.example.com/opencode",
        "remoteServer.auth.mode": "none",
        "remoteServer.projectTarget.mode": "server_default",
        "remoteServer.requireHealthyServer": true,
        "remoteServer.healthTimeoutSec": 12,
      },
    });

    const parsed = opencodeFullPersistedConfigSchema.parse(config);
    expect(parsed.executionMode).toBe("remote_server");
    if (parsed.executionMode !== "remote_server") throw new Error("expected remote_server");
    expect(parsed.remoteServer.auth).toEqual({ mode: "none" });
    expect(parsed.remoteServer.projectTarget.mode).toBe("server_default");
    expect(parsed.remoteServer.baseUrl).toBe("https://gateway.example.com/opencode");
  });

  it("preserves secret-ref auth bindings from first-class auth fields", () => {
    const secretRef = {
      type: "secret_ref" as const,
      secretId: "11111111-1111-4111-8111-111111111111",
      version: "latest" as const,
    };

    const bearerConfig = buildOpenCodeFullConfig({
      adapterType: "opencode_full",
      cwd: "",
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
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://gateway.example.com/opencode",
        "remoteServer.auth.mode": "bearer",
        "remoteServer.auth.token": secretRef,
      },
    });

    const bearerParsed = opencodeFullPersistedConfigSchema.parse(bearerConfig);
    if (bearerParsed.executionMode !== "remote_server") throw new Error("expected remote_server");
    expect(bearerParsed.remoteServer.auth).toEqual({ mode: "bearer", token: secretRef });

    const basicConfig = buildOpenCodeFullConfig({
      adapterType: "opencode_full",
      cwd: "",
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
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://gateway.example.com/opencode",
        "remoteServer.auth.mode": "basic",
        "remoteServer.auth.username": "operator",
        "remoteServer.auth.password": secretRef,
      },
    });

    const basicParsed = opencodeFullPersistedConfigSchema.parse(basicConfig);
    if (basicParsed.executionMode !== "remote_server") throw new Error("expected remote_server");
    expect(basicParsed.remoteServer.auth).toEqual({ mode: "basic", username: "operator", password: secretRef });

    const headerConfig = buildOpenCodeFullConfig({
      adapterType: "opencode_full",
      cwd: "",
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
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://gateway.example.com/opencode",
        "remoteServer.auth.mode": "header",
        "remoteServer.auth.headerName": "X-API-Key",
        "remoteServer.auth.headerValue": secretRef,
      },
    });

    const headerParsed = opencodeFullPersistedConfigSchema.parse(headerConfig);
    if (headerParsed.executionMode !== "remote_server") throw new Error("expected remote_server");
    expect(headerParsed.remoteServer.auth).toEqual({ mode: "header", headerName: "X-API-Key", headerValue: secretRef });
  });

  it("rejects route-suffixed base URLs while preserving reverse-proxy base paths", () => {
    expect(() => opencodeFullPersistedConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://example.com/global/health",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    })).toThrow(/server root or reverse-proxy base path/i);

    const parsed = opencodeFullPersistedConfigSchema.parse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://example.com/proxy/opencode",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    });

    expect(parsed.executionMode).toBe("remote_server");
  });

  it("renders truthful remote copy, fixed server_default UI, and config-surface base-url validation", async () => {
    const root = createRoot(container);
    const values = {
      adapterType: "opencode_full",
      cwd: "",
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
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://example.com/global/health",
        "remoteServer.auth.mode": "none",
      },
    };

    const renderFields = async () => {
      await act(async () => {
        root.render(
          <TooltipProvider>
            <SchemaConfigFields
              mode="create"
              isCreate
              adapterType="opencode_full"
              values={values}
              set={(patch) => {
                Object.assign(values, patch);
              }}
              config={{}}
              eff={(_, __, original) => original}
              mark={vi.fn()}
              models={[]}
            />
          </TooltipProvider>,
        );
        await flushRender();
      });
    };

    await renderFields();
    values.adapterSchemaValues = {
      ...values.adapterSchemaValues,
      executionMode: "remote_server",
      "remoteServer.baseUrl": "https://example.com/global/health",
      "remoteServer.auth.mode": "none",
    };
    await renderFields();

    const text = container.textContent ?? "";
    expect(text).toContain("Connect to an already-running OpenCode server.");
    expect(text).toContain("Paperclip checks config, reachability, auth, health, and model availability only.");
    expect(text).toContain("Target mode");
    expect(text).toContain("server_default");

    const invalidConfig = buildOpenCodeFullConfig(values);
    const invalidResult = opencodeFullPersistedConfigSchema.safeParse(invalidConfig);
    expect(invalidResult.success).toBe(false);
    if (invalidResult.success) throw new Error("expected invalid config");
    expect(invalidResult.error.issues.some((issue) => issue.message.match(/server root or reverse-proxy base path/i))).toBe(true);

    values.adapterSchemaValues = {
      ...values.adapterSchemaValues,
      "remoteServer.baseUrl": "https://example.com/proxy/opencode",
    };

    const validConfig = buildOpenCodeFullConfig(values);
    const validResult = opencodeFullPersistedConfigSchema.safeParse(validConfig);
    expect(validResult.success).toBe(true);

    act(() => root.unmount());
  });
});

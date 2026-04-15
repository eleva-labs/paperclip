// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { getOpencodeFullConfigSchema, opencodeFullPersistedConfigSchema } from "../../../packages/adapters/opencode-full/src/server/config-schema";
import { buildOpenCodeFullConfig } from "../../../packages/adapters/opencode-full/src/ui/index";
import { adaptersApi } from "./adapters";
import { SchemaConfigFields } from "../adapters/schema-config-fields";
import { TooltipProvider } from "../components/ui/tooltip";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushRender() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("adaptersApi opencode_full integration", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValue(getOpencodeFullConfigSchema());
  });

  afterEach(() => {
    container.remove();
  });

  it("requests the config-schema endpoint for opencode_full", async () => {
    const schema = await adaptersApi.configSchema("opencode_full");

    expect(mockApi.get).toHaveBeenCalledWith("/adapters/opencode_full/config-schema");
    expect(schema.fields.some((field) => field.key === "remoteServer.baseUrl")).toBe(true);
  });

  it("renders truthful remote copy and validates only MVP server_default setup", async () => {
    const root = createRoot(container);
    const values: CreateConfigValues = {
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
    expect(text).toContain("Target mode");
    expect(text).toContain("server_default");
    expect(text).not.toContain("manage the remote OpenCode server");

    const invalidConfig = buildOpenCodeFullConfig(values);
    const invalidResult = opencodeFullPersistedConfigSchema.safeParse(invalidConfig);
    expect(invalidResult.success).toBe(false);

    values.adapterSchemaValues = {
      ...values.adapterSchemaValues,
      "remoteServer.baseUrl": "https://example.com/proxy/opencode",
      "remoteServer.projectTarget.mode": "server_default",
    };

    const validConfig = buildOpenCodeFullConfig(values);
    const validResult = opencodeFullPersistedConfigSchema.safeParse(validConfig);
    expect(validResult.success).toBe(true);

    act(() => root.unmount());
  });
});

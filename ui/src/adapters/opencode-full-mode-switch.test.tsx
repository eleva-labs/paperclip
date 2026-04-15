// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { SchemaConfigFields } from "./schema-config-fields";
import { adaptersApi } from "../api/adapters";
import type { AdapterConfigSchemaResponse } from "../api/adapters";

async function flushRender() {
  await Promise.resolve();
  await Promise.resolve();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/adapters", () => ({
  adaptersApi: {
    configSchema: vi.fn(),
  },
}));

const opencodeFullSchemaResponse: AdapterConfigSchemaResponse = {
  fields: [
    { key: "executionMode", label: "Execution mode", type: "select", default: "local_cli", options: [
      { value: "local_cli", label: "Local CLI" },
      { value: "remote_server", label: "Remote server" },
      { value: "local_sdk", label: "Local SDK (deferred)" },
    ] },
    { key: "model", label: "Model", type: "combobox", required: true },
    { key: "remoteServer.baseUrl", label: "Remote server · Base URL", type: "text" },
    { key: "remoteServer.auth.mode", label: "Remote server · Authentication", type: "select", default: "none", options: [
      { value: "none", label: "None (MVP happy path)" },
      { value: "bearer", label: "Bearer token (advanced placeholder)" },
    ] },
    { key: "remoteServer.auth.token", label: "Remote server · Bearer token", type: "text" },
    { key: "remoteServer.healthTimeoutSec", label: "Remote server · Health timeout (sec)", type: "number", default: 10 },
    { key: "remoteServer.requireHealthyServer", label: "Remote server · Require healthy server", type: "toggle", default: true },
    { key: "remoteServer.projectTarget.mode", label: "Remote server · Target mode", type: "select", default: "server_default", options: [
      { value: "server_default", label: "server_default (MVP supported)" },
    ] },
    { key: "localCli.command", label: "Local CLI · Command", type: "text", default: "opencode" },
  ],
};

describe("opencode_full mode switch", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(adaptersApi.configSchema).mockResolvedValue(opencodeFullSchemaResponse);
  });

  afterEach(() => {
    container.remove();
  });

  it("hides irrelevant fields and retains per-mode values while editing", async () => {
    const root = createRoot(container);
    let latestPatch: Record<string, unknown> | null = null;
    const values = {
      adapterType: "opencode_full",
      cwd: "",
      promptTemplate: "",
      model: "",
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
        executionMode: "local_cli",
        "remoteServer.baseUrl": "https://example.com/opencode",
        "localCli.command": "opencode",
      },
    };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SchemaConfigFields
            mode="create"
            isCreate
            adapterType="opencode_full"
            values={values}
            set={(patch) => {
              latestPatch = patch as Record<string, unknown>;
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

    const executionModeButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Local CLI"),
    );
    expect(executionModeButton).toBeDefined();

    await act(async () => {
      executionModeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushRender();
    });

    const popoverText = document.body.textContent ?? "";
    expect(popoverText).toContain("Local CLI");
    expect(popoverText).toContain("Remote server");
    expect(popoverText).not.toContain("Local SDK (deferred)");

    expect(container.textContent).toContain("Local CLI · Command");
    expect(container.textContent).not.toContain("Remote server setup");

    values.adapterSchemaValues = {
      ...values.adapterSchemaValues,
      executionMode: "remote_server",
    };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SchemaConfigFields
            mode="create"
            isCreate
            adapterType="opencode_full"
            values={values}
            set={(patch) => {
              latestPatch = patch as Record<string, unknown>;
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

    expect(container.textContent).toContain("Remote server setup");
    expect(container.textContent).not.toContain("Local CLI · Command");
    expect(values.adapterSchemaValues?.executionMode).toBe("remote_server");
    expect(values.adapterSchemaValues?.["remoteServer.baseUrl"]).toBe("https://example.com/opencode");
    expect(values.adapterSchemaValues?.["localCli.command"]).toBe("opencode");

    values.adapterSchemaValues = {
      ...values.adapterSchemaValues,
      executionMode: "local_cli",
    };

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SchemaConfigFields
            mode="create"
            isCreate
            adapterType="opencode_full"
            values={values}
            set={(patch) => {
              latestPatch = patch as Record<string, unknown>;
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

    expect(latestPatch).toBeTruthy();
    expect(values.adapterSchemaValues?.executionMode).toBe("local_cli");
    expect(values.adapterSchemaValues?.["remoteServer.baseUrl"]).toBe("https://example.com/opencode");

    act(() => root.unmount());
  });
});

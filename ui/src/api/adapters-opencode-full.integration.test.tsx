// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { getOpencodeFullConfigSchema, opencodeFullPersistedConfigSchema } from "../../../packages/adapters/opencode-full/src/server/config-schema";
import { buildOpenCodeFullConfig } from "../../../packages/adapters/opencode-full/src/ui/index";
import { adaptersApi } from "./adapters";
import { SchemaConfigFields } from "../adapters/schema-config-fields";
import { AgentConfigForm } from "../components/AgentConfigForm";
import { TooltipProvider } from "../components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("./client", () => ({
  api: mockApi,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
  }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: {
    adapterModels: vi.fn().mockResolvedValue([]),
    detectModel: vi.fn().mockResolvedValue({ model: null, candidates: [] }),
    list: vi.fn().mockResolvedValue([]),
    testEnvironment: vi.fn(),
  },
}));

vi.mock("../api/secrets", () => ({
  secretsApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));

vi.mock("../api/assets", () => ({
  assetsApi: {
    uploadImage: vi.fn(),
  },
}));

vi.mock("../components/MarkdownEditor", async () => {
  const React = await import("react");
  return {
    MarkdownEditor: ({ value }: { value?: string }) => React.createElement("div", null, value ?? ""),
  };
});

vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => new Set<string>(),
}));

vi.mock("../adapters/metadata", () => ({
  listAdapterOptions: () => [{ value: "opencode_full", label: "OpenCode (full)", comingSoon: false }],
  listVisibleAdapterTypes: () => ["opencode_full"],
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => type,
  getAdapterLabels: () => ({ opencode_full: "OpenCode (full)" }),
}));

vi.mock("../adapters", async () => {
  const React = await import("react");
  return {
    getUIAdapter: () => ({
      type: "opencode_full",
      label: "OpenCode (full)",
      parseStdoutLine: () => [],
      ConfigFields: () => React.createElement("div", null, "Mock adapter fields"),
      buildAdapterConfig: () => ({}),
    }),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushRender() {
  await Promise.resolve();
  await Promise.resolve();
}

function createLinkedAgent(): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "OpenCode Remote",
    role: "general",
    title: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "opencode_full",
    urlKey: "opencode-remote",
    icon: null,
    permissions: {},
    metadata: {},
    adapterConfig: {
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://remote.example.com/opencode",
        auth: { mode: "none" },
        projectTarget: { mode: "linked_project_context" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/srv/repos/forgebox",
          serverScope: "shared",
          validatedAt: "2026-04-16T12:00:00.000Z",
        },
      },
    },
    runtimeConfig: {},
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z",
    archivedAt: null,
    pausedAt: null,
    pauseReason: null,
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    lastHeartbeatAt: null,
  } as unknown as Agent;
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

  it("shows plugin-derived linked-project state while keeping non-none auth out of MVP success paths", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AgentConfigForm
              mode="edit"
              agent={createLinkedAgent()}
              onSave={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
      await flushRender();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Project-linked remote context (plugin-derived)");
    expect(text).toContain("The plugin owns the project link status and base URL authority");
    expect(text).toContain("linked_project_context");
    expect(text).toContain("https://remote.example.com/opencode");
    expect(text).toContain("/srv/repos/forgebox");
    expect(text).not.toContain("bearer");
    expect(text).not.toContain("basic");
    expect(text).not.toContain("header");

    act(() => root.unmount());
    queryClient.clear();
  });
});

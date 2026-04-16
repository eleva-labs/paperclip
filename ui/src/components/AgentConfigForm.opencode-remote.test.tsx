// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { AgentConfigForm } from "./AgentConfigForm";
import { TooltipProvider } from "./ui/tooltip";

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

vi.mock("./MarkdownEditor", async () => {
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

function createAgent(): Agent {
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

describe("AgentConfigForm opencode remote state", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("shows plugin-derived linked-project state without implying per-agent ownership", async () => {
    const root = createRoot(container);
    const queryClient = new QueryClient();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AgentConfigForm
              mode="edit"
              agent={createAgent()}
              onSave={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Project-linked remote context (plugin-derived)");
    expect(text).toContain("The plugin owns the project link status and base URL authority");
    expect(text).toContain("linked_project_context");
    expect(text).toContain("https://remote.example.com/opencode");
    expect(text).toContain("/srv/repos/forgebox");

    act(() => root.unmount());
    queryClient.clear();
  });
});

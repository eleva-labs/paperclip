// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePluginPageProjectId } from "./PluginPage";
import { ProjectDetailTab } from "../../../packages/plugins/opencode-project-sync/src/ui/index";

const pluginSdkState = vi.hoisted(() => ({
  hostContext: {
    companyId: "company-1",
    projectId: "project-1",
    companyPrefix: "ACME",
  },
  dataByKey: {} as Record<string, unknown>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function installPluginBridgeRuntime() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__paperclipPluginBridge__ = {
    react: {
      createElement: undefined,
    },
    sdkUi: {
      useHostContext: () => pluginSdkState.hostContext,
      usePluginToast: () => vi.fn(),
      usePluginAction: () => vi.fn().mockResolvedValue({}),
      usePluginData: (key: string) => ({
        data: pluginSdkState.dataByKey[key],
        loading: false,
        error: null,
        refresh: vi.fn(),
      }),
      usePluginStream: vi.fn(),
    },
  };
}

const detailTabContext = {
  companyId: "company-1",
  companyPrefix: "ACME",
  projectId: "project-1",
  entityId: "project-1",
  entityType: "project",
  userId: "user-1",
};

describe("OpenCode plugin remote UI", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    installPluginBridgeRuntime();
  });

  afterEach(() => {
    container.remove();
    pluginSdkState.dataByKey = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).__paperclipPluginBridge__;
  });

  it("parses projectId from plugin page search params", () => {
    expect(resolvePluginPageProjectId("?projectId=project-123")).toBe("project-123");
    expect(resolvePluginPageProjectId("?projectId=   ")).toBeNull();
    expect(resolvePluginPageProjectId("")).toBeNull();
  });

  it("renders not-linked project remote status and hides recovery actions until a link exists", async () => {
    pluginSdkState.dataByKey = {
      "project-sync-state": {
        workspace: {
          projectId: "project-1",
          workspaceId: "workspace-1",
          cwd: "/repo",
          repoUrl: null,
          repoRef: null,
        },
        state: {
          sourceOfTruth: "repo_first",
          bootstrapCompletedAt: null,
          canonicalRepoRoot: "/repo",
          canonicalRepoUrl: null,
          canonicalRepoRef: null,
          lastScanFingerprint: null,
          lastImportedAt: null,
          lastExportedAt: null,
          lastRuntimeTestAt: null,
          warnings: [],
          conflicts: [],
          importedAgents: [],
          importedSkills: [],
          selectedAgents: [],
        },
      },
      "project-sync-preview": {
        preview: {
          warnings: [],
          lastScanFingerprint: "scan-1",
          eligibleAgents: [],
          ineligibleNestedAgents: [],
          ignoredArtifacts: [],
        },
      },
      "project-remote-mode-status": {
        canonicalWorkspaceId: "workspace-1",
        canonicalRepoRoot: "/repo",
        companyBaseUrlDefault: "https://remote.example.com/opencode",
        remoteLink: null,
        syncAllowed: true,
        syncBlockReason: null,
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<ProjectDetailTab context={detailTabContext} />);
    });

    const text = container.textContent ?? "";
    expect(text).toContain("This project is not linked to a remote OpenCode project context yet");
    expect(text).toContain("Link remote");

    const buttons = Array.from(container.querySelectorAll("button"));
    const refreshButton = buttons.find((button) => button.textContent?.includes("Refresh remote"));
    const clearButton = buttons.find((button) => button.textContent?.includes("Clear remote"));
    expect(refreshButton?.hasAttribute("disabled")).toBe(true);
    expect(clearButton?.hasAttribute("disabled")).toBe(true);

    act(() => root.unmount());
  });

  it("renders stale remote status with recovery actions visible", async () => {
    pluginSdkState.dataByKey = {
      "project-sync-state": {
        workspace: {
          projectId: "project-1",
          workspaceId: "workspace-1",
          cwd: "/repo",
          repoUrl: null,
          repoRef: null,
        },
        state: {
          sourceOfTruth: "repo_first",
          bootstrapCompletedAt: "2026-04-16T12:00:00.000Z",
          canonicalRepoRoot: "/repo",
          canonicalRepoUrl: null,
          canonicalRepoRef: null,
          lastScanFingerprint: "scan-1",
          lastImportedAt: "2026-04-16T12:10:00.000Z",
          lastExportedAt: null,
          lastRuntimeTestAt: null,
          warnings: [],
          conflicts: [],
          importedAgents: [],
          importedSkills: [],
          selectedAgents: [],
        },
      },
      "project-sync-preview": {
        preview: {
          warnings: [],
          lastScanFingerprint: "scan-1",
          eligibleAgents: [],
          ineligibleNestedAgents: [],
          ignoredArtifacts: [],
        },
      },
      "project-remote-mode-status": {
        canonicalWorkspaceId: "workspace-1",
        canonicalRepoRoot: "/repo",
        companyBaseUrlDefault: "https://remote.example.com/opencode",
        remoteLink: {
          status: "stale",
          baseUrl: "https://remote.example.com/opencode",
          linkedDirectoryHint: "/srv/repos/forgebox",
          invalidReason: "Directory proof no longer matches.",
          propagatedToImportedAgentsAt: null,
        },
        syncAllowed: false,
        syncBlockReason: "Remote link must be refreshed before sync can continue.",
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<ProjectDetailTab context={detailTabContext} />);
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Remote stale");
    expect(text).toContain("Linked directory hint");
    expect(text).toContain("Managed imported agents are rewritten automatically before link, refresh-with-change, or clear reports success");
    expect(text).toContain("Remote sync gating");

    const buttons = Array.from(container.querySelectorAll("button"));
    const refreshButton = buttons.find((button) => button.textContent?.includes("Refresh remote"));
    const clearButton = buttons.find((button) => button.textContent?.includes("Clear remote"));
    expect(refreshButton?.hasAttribute("disabled")).toBe(false);
    expect(clearButton?.hasAttribute("disabled")).toBe(false);

    act(() => root.unmount());
  });
});

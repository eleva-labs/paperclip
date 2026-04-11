// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaConfigFields } from "./schema-config-fields";
import { TooltipProvider } from "../components/ui/tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../components/PathInstructionsModal", () => ({
  ChoosePathButton: () => <button type="button">Choose</button>,
}));

const projectSchemaResponse = {
  fields: [
    { key: "command", label: "Command", type: "text", default: "opencode", hint: "OpenCode CLI binary to execute." },
    { key: "model", label: "Model", type: "combobox", required: true, hint: "OpenCode model id in provider/model format." },
    { key: "variant", label: "Variant", type: "text", hint: "Optional provider-specific reasoning/profile variant." },
    { key: "cwd", label: "Fallback CWD", type: "text", hint: "Adapter fallback working directory when no canonical or execution workspace is resolved." },
    { key: "instructionsFilePath", label: "Instructions File Path", type: "text", hint: "Absolute path to a markdown instructions file prepended to the run prompt." },
    { key: "extraArgs", label: "Extra Args", type: "textarea", hint: "Additional OpenCode CLI args." },
    { key: "env", label: "Environment Variables", type: "textarea", hint: "Additional environment variables passed to the OpenCode process." },
    { key: "promptTemplate", label: "Prompt Template", type: "textarea" },
    { key: "bootstrapPromptTemplate", label: "Bootstrap Prompt Template", type: "textarea", hint: "Reserved for project bootstrap/sync UX guidance." },
    { key: "dangerouslySkipPermissions", label: "Skip Permissions", type: "toggle", default: true, hint: "Allow unattended runs without interactive OpenCode approval prompts." },
    { key: "allowProjectConfig", label: "Allow Project Config", type: "toggle", default: true, hint: "Enable repo-local opencode.json and .opencode discovery for this adapter type." },
    { key: "canonicalWorkspaceOnly", label: "Canonical Workspace Only", type: "toggle", default: false, hint: "Block execution outside the canonical project workspace when enabled." },
    { key: "syncPluginKey", label: "Sync Plugin Key", type: "text", default: "paperclip-opencode-project", hint: "Plugin manifest id expected to own project sync state." },
    { key: "timeoutSec", label: "Timeout (sec)", type: "number", hint: "Optional runtime timeout in seconds." },
    { key: "graceSec", label: "Grace Period (sec)", type: "number", hint: "Optional SIGTERM grace period in seconds." },
  ],
};

describe("SchemaConfigFields", () => {
  let container: HTMLDivElement;
  const fetchMock = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => projectSchemaResponse,
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("hides duplicated opencode project fields and keeps project-specific options compact", async () => {
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <TooltipProvider>
          <SchemaConfigFields
            mode="create"
            isCreate
            adapterType="opencode_project_local"
            values={{
              adapterType: "opencode_project_local",
              cwd: "",
              instructionsFilePath: "",
              promptTemplate: "",
              model: "",
              thinkingEffort: "",
              chrome: false,
              dangerouslySkipPermissions: true,
              search: false,
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
            }}
            set={vi.fn()}
            config={{}}
            eff={(_, __, original) => original}
            mark={vi.fn()}
            models={[]}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Agent instructions file");
    expect(text).toContain("Skip permissions");
    expect(text).toContain("Project adapter options");
    expect(text).not.toContain("Instructions File Path");
    expect(text).not.toContain("Prompt Template");
    expect(text).not.toContain("Extra Args");
    expect(text).not.toContain("Environment Variables");
    expect(text).not.toContain("Timeout (sec)");
    expect(text).not.toContain("Grace Period (sec)");

    const buttons = Array.from(container.querySelectorAll("button"));
    const advancedToggle = buttons.find((button) => button.textContent?.includes("Project adapter options"));
    expect(advancedToggle).toBeDefined();

    await act(async () => {
      advancedToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const expandedText = container.textContent ?? "";
    expect(expandedText).toContain("Fallback CWD");
    expect(expandedText).toContain("Bootstrap Prompt Template");
    expect(expandedText).toContain("Allow Project Config");
    expect(expandedText).toContain("Canonical Workspace Only");
    expect(expandedText).toContain("Sync Plugin Key");

    act(() => {
      root.unmount();
    });
  });
});

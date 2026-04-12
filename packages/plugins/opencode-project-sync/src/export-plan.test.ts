import { describe, expect, it } from "vitest";
import { buildExportPlan, validateExportRepoRelPath } from "./export-plan.js";
import type { OpencodeProjectSyncState } from "./sync-state.js";

const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

function makeState(): OpencodeProjectSyncState {
  return {
    projectId,
    workspaceId,
    bootstrapCompletedAt: null,
    canonicalRepoRoot: "/repos/canonical",
    canonicalRepoUrl: "https://example.com/acme/repo.git",
    canonicalRepoRef: "main",
    lastScanFingerprint: "scan-1",
    lastImportedAt: null,
    lastExportedAt: null,
    manifestVersion: 2,
    syncPolicy: {
      mode: "top_level_agents_only",
      syncSkills: false,
      importRootAgentsMd: false,
      importNestedAgents: false,
    },
    selectedAgents: [],
    importedAgents: [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent",
      canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
      externalAgentName: "Researcher",
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }],
    warnings: [],
    conflicts: [],
  };
}

describe("validateExportRepoRelPath", () => {
  it("rejects non-canonical or out-of-scope export paths", () => {
    expect(validateExportRepoRelPath("agent", "../escape.md")).toEqual({
      ok: false,
      message: "Export target '../escape.md' is not a canonical relative path inside the repo root.",
    });
    expect(validateExportRepoRelPath("skill", ".opencode/agents/researcher.md")).toEqual({
      ok: false,
      message: "Export target '.opencode/agents/researcher.md' is outside the MVP skill export roots.",
    });
  });
});

describe("buildExportPlan", () => {
  it("blocks export when canonical repo drift invalidates the last import fingerprint", () => {
    const plan = buildExportPlan({
      state: makeState(),
      currentRepoFingerprint: "scan-2",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [],
    });

    expect(plan.blocked).toBe(true);
    expect(plan.files).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift" }),
    ]);
  });

  it("exports only sync-managed entities and reports operator-visible drift conflicts", () => {
    const plan = buildExportPlan({
      state: makeState(),
      currentRepoFingerprint: "scan-1",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [
        {
          id: "agent-1",
          name: "Researcher",
          title: "Lead researcher",
          reportsTo: null,
          adapterConfig: { promptTemplate: "# Researcher\n" },
          metadata: {
            syncManaged: true,
            sourceSystem: "opencode_project_repo",
            syncPolicyMode: "top_level_agents_only",
            sourceOfTruth: "repo_first",
            projectId,
            workspaceId,
            repoRoot: "/repos/canonical",
            repoRelPath: ".opencode/agents/researcher.md",
            canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
            externalAgentKey: "researcher",
            externalAgentName: "Researcher",
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            lastImportedFingerprint: "fp-agent",
            lastImportedAt: null,
            lastExportedFingerprint: null,
            lastExportedAt: null,
          },
        },
        {
          id: "agent-unmanaged",
          name: "Unmanaged",
          title: null,
          reportsTo: null,
          adapterConfig: {},
          metadata: null,
        },
      ],
    });

    expect(plan.blocked).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.map((file) => file.repoRelPath)).toEqual([
      ".opencode/agents/researcher.md",
    ]);
  });

  it("blocks export when a manifest-managed agent no longer carries valid sync metadata", () => {
    const plan = buildExportPlan({
      state: makeState(),
      currentRepoFingerprint: "scan-1",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterConfig: {},
        metadata: { syncManaged: false },
      }],
    });

    expect(plan.blocked).toBe(true);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift", entityType: "agent", entityKey: "agent-1" }),
    ]);
  });
});

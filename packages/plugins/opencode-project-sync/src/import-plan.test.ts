import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./import-plan.js";
import type { OpencodeProjectSyncState } from "./sync-state.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const repoRoot = "/repos/canonical";
const importedAt = "2026-04-11T12:00:00.000Z";

function makeState(): OpencodeProjectSyncState {
  return {
    projectId,
    workspaceId,
    bootstrapCompletedAt: null,
    canonicalRepoRoot: repoRoot,
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
    importedAgents: [],
    legacyOutOfScopeEntities: [],
    warnings: [],
    conflicts: [],
  };
}

describe("buildImportPlan", () => {
  it("reuses prior manifest ids for stable identity and idempotent sync updates", () => {
    const state = makeState();
    state.importedAgents = [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent-old",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentName: "Researcher",
      lastImportedAt: importedAt,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }];

    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: state,
      existingAgents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterType: "opencode_project_local",
        adapterConfig: { model: "openai/gpt-5.4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-agent-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: "Lead researcher",
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-agent-new",
        }],
      },
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.skillUpserts).toEqual([]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({
        operation: "update",
        paperclipAgentId: "agent-1",
        payload: expect.objectContaining({
          adapterType: "opencode_project_local",
          adapterConfig: expect.objectContaining({
            allowProjectConfig: true,
            syncPluginKey: "paperclip-opencode-project",
          }),
        }),
      }),
    ]);
  });

  it("surfaces discovery conflicts and unresolved desired skill warnings", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["missing", "researcher"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [{
          code: "invalid_repo_file",
          message: "Repo-root opencode.json exists but could not be parsed as a JSON object.",
          repoRelPath: "opencode.json",
          entityType: "workspace",
          entityKey: null,
        }],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-agent",
        }],
      },
    });

    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "invalid_selection", entityKey: "missing" }),
    ]);
    expect(plan.warnings).toEqual([
      "Repo-root opencode.json exists but could not be parsed as a JSON object.",
    ]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({ externalAgentKey: "researcher" }),
    ]);
  });
});

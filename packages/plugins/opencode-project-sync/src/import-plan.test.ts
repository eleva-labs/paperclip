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
        matchBasis: "manifest_link",
        payload: expect.objectContaining({
          adapterType: "opencode_project_local",
          reportsTo: null,
          adapterConfig: expect.objectContaining({
            allowProjectConfig: true,
            syncPluginKey: "paperclip-opencode-project",
          }),
          metadata: expect.objectContaining({
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            repoRoot,
            repoRelPath: ".opencode/agents/researcher.md",
            workspaceId,
            projectId,
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

  it("updates metadata-linked managed agents but never adopts unmanaged lookalikes", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher", "writer"],
      importedAt,
      existingState: makeState(),
      existingAgents: [
        {
          id: "agent-managed",
          name: "Researcher",
          title: "Lead researcher",
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
        },
        {
          id: "agent-unmanaged",
          name: "Writer",
          title: "Writer",
          reportsTo: null,
          adapterType: "opencode_project_local",
          adapterConfig: { promptTemplate: "# Writer\n" },
          metadata: null,
        },
      ],
      discovery: {
        warnings: [],
        eligibleAgents: [
          {
            externalAgentKey: "researcher",
            displayName: "Researcher",
            role: "Lead researcher",
            repoRelPath: ".opencode/agents/researcher.md",
            instructionsMarkdown: "# Researcher\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-agent-new",
          },
          {
            externalAgentKey: "writer",
            displayName: "Writer",
            role: "Writer",
            repoRelPath: ".opencode/agents/writer.md",
            instructionsMarkdown: "# Writer\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-writer",
          },
        ],
      },
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({ externalAgentKey: "researcher", operation: "update", paperclipAgentId: "agent-managed", matchBasis: "metadata_link" }),
      expect.objectContaining({ externalAgentKey: "writer", operation: "create", paperclipAgentId: null, matchBasis: "new_agent" }),
    ]);
  });

  it("emits paperclip_entity_drift for manifest-linked provenance mismatch", () => {
    const state = makeState();
    state.importedAgents = [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-old",
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
        adapterConfig: {},
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/other.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/other.md`,
          externalAgentKey: "other",
          externalAgentName: "Other",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
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
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-new",
        }],
      },
    });

    expect(plan.agentUpserts).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift", entityKey: "agent-1" }),
    ]);
  });

  it("emits paperclip_entity_drift for duplicate metadata-linked managed agents", () => {
    const managedMetadata = {
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
      lastImportedFingerprint: "fp-old",
      lastImportedAt: importedAt,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    };
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: makeState(),
      existingAgents: [
        { id: "agent-1", name: "Researcher", title: null, reportsTo: null, adapterType: "opencode_project_local", adapterConfig: {}, metadata: managedMetadata },
        { id: "agent-2", name: "Researcher Duplicate", title: null, reportsTo: null, adapterType: "opencode_project_local", adapterConfig: {}, metadata: managedMetadata },
      ],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-new",
        }],
      },
    });

    expect(plan.agentUpserts).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift", entityKey: "researcher" }),
    ]);
  });
});

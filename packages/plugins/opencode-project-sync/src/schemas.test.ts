import { describe, expect, it } from "vitest";
import {
  importedOpencodeAgentMetadataSchema,
  opencodeProjectConflictSchema,
  opencodeProjectFinalizeSyncInputSchema,
  opencodeProjectSyncNowInputSchema,
  opencodeTopLevelAgentPreviewSchema,
  opencodeProjectTestRuntimeInputSchema,
} from "./schemas.js";
import { opencodeProjectSyncStateSchema } from "./sync-state.js";

describe("opencode project package schemas", () => {
  it("rejects malformed action inputs and supports selectedAgentKeys", () => {
    expect(opencodeProjectSyncNowInputSchema.safeParse({ companyId: "bad", projectId: "still-bad" }).success).toBe(false);

    const parsed = opencodeProjectSyncNowInputSchema.parse({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed.selectedAgentKeys).toEqual([]);

    expect(opencodeProjectTestRuntimeInputSchema.safeParse({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      agentId: "not-a-uuid",
      workspaceMode: "worktree",
    }).success).toBe(false);
  });

  it("enforces facade-agent imported metadata contract", () => {
    const result = importedOpencodeAgentMetadataSchema.safeParse({
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      syncPolicyMode: "top_level_agents_only",
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      repoRoot: "/repos/canonical",
      repoRelPath: ".opencode/agents/researcher.md",
      canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
      externalAgentKey: "researcher",
      externalAgentName: "Researcher",
      importRole: "facade_entrypoint",
      topLevelAgent: true,
      lastImportedFingerprint: null,
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    });

    expect(result.success).toBe(true);
  });

  it("enforces top-level preview and agent-only conflict vocabulary", () => {
    expect(opencodeTopLevelAgentPreviewSchema.safeParse({
      lastScanFingerprint: "abc",
      eligibleAgents: [],
      ineligibleNestedAgents: [],
      ignoredArtifacts: [],
      warnings: [],
    }).success).toBe(true);

    expect(opencodeProjectConflictSchema.safeParse({
      code: "identity_collision",
      message: "dup",
      repoRelPath: ".opencode/agents/a.md",
      entityType: "agent",
      entityKey: "a",
    }).success).toBe(true);

    expect(opencodeProjectConflictSchema.safeParse({
      code: "ambiguous_repo_layout",
      message: "nope",
      repoRelPath: null,
      entityType: "workspace",
      entityKey: null,
    }).success).toBe(false);
  });

  it("requires agent-only finalize payload shape", () => {
    expect(opencodeProjectFinalizeSyncInputSchema.safeParse({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-04-11T12:00:00.000Z",
      lastScanFingerprint: "abc123",
      selectedAgentKeys: ["researcher"],
      warnings: [],
      agentUpserts: [{
        operation: "create",
        paperclipAgentId: null,
        externalAgentKey: "researcher",
        repoRelPath: ".opencode/agents/researcher.md",
        fingerprint: "fp",
      }],
      appliedAgents: [{
        externalAgentKey: "researcher",
        paperclipAgentId: "33333333-3333-4333-8333-333333333333",
      }],
    }).success).toBe(true);
  });

  it("rejects malformed persisted sync state for manifest v2", () => {
    const result = opencodeProjectSyncStateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      canonicalRepoRoot: "/repos/canonical",
      canonicalRepoUrl: null,
      canonicalRepoRef: null,
      bootstrapCompletedAt: null,
      lastScanFingerprint: null,
      lastImportedAt: null,
      lastExportedAt: null,
      manifestVersion: 999,
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
    });

    expect(result.success).toBe(false);
  });
});

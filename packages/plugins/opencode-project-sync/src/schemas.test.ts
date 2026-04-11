import { describe, expect, it } from "vitest";
import {
  importedOpencodeAgentMetadataSchema,
  opencodeProjectExportInputSchema,
  opencodeProjectSyncNowInputSchema,
  opencodeProjectTestRuntimeInputSchema,
} from "./schemas.js";
import { opencodeProjectSyncStateSchema } from "./sync-state.js";

describe("opencode project package schemas", () => {
  it("rejects malformed action inputs", () => {
    expect(opencodeProjectSyncNowInputSchema.safeParse({ companyId: "bad", projectId: "still-bad" }).success).toBe(false);
    expect(opencodeProjectExportInputSchema.safeParse({ companyId: "bad", projectId: "still-bad", exportAgents: "yes" }).success).toBe(false);
    expect(opencodeProjectTestRuntimeInputSchema.safeParse({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      agentId: "not-a-uuid",
      workspaceMode: "worktree",
    }).success).toBe(false);
  });

  it("rejects malformed imported adapter metadata", () => {
    const result = importedOpencodeAgentMetadataSchema.safeParse({
      syncManaged: true,
      sourceSystem: "wrong",
      sourceOfTruth: "repo_first",
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      repoRoot: "",
      repoRelPath: ".opencode/agents/researcher.md",
      canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
      externalAgentKey: "researcher",
      externalAgentName: "Researcher",
      folderPath: null,
      hierarchyMode: "metadata_only",
      reportsToExternalKey: null,
      desiredSkillKeys: ["research"],
      lastImportedFingerprint: null,
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed persisted sync state", () => {
    const result = opencodeProjectSyncStateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      sourceOfTruth: "repo_first",
      bootstrapCompletedAt: null,
      canonicalRepoRoot: "/repos/canonical",
      canonicalRepoUrl: null,
      canonicalRepoRef: null,
      lastScanFingerprint: null,
      lastScanCommit: null,
      lastImportedAt: null,
      lastExportedAt: null,
      lastRuntimeTestAt: null,
      lastRuntimeTestResult: { ok: true, message: "", details: [] },
      manifestVersion: 999,
      importedAgents: [],
      importedSkills: [],
      warnings: [],
      conflicts: [],
    });

    expect(result.success).toBe(false);
  });
});

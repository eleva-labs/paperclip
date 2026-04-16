import { describe, expect, it } from "vitest";
import {
  importedOpencodeAgentMetadataSchema,
  opencodeProjectClearRemoteLinkResultSchema,
  opencodeProjectConflictSchema,
  opencodeProjectFinalizeSyncInputSchema,
  opencodeProjectLinkRemoteContextResultSchema,
  opencodeProjectResolveRemoteModeStatusResultSchema,
  opencodeProjectSyncCompanySettingsSchema,
  opencodeProjectPlannedAgentUpsertSchema,
  opencodeProjectSyncNowInputSchema,
  opencodeTopLevelAgentPreviewSchema,
  opencodeProjectTestRuntimeInputSchema,
} from "./schemas.js";
import { opencodeProjectSyncStateSchema } from "./sync-state.js";

describe("opencode project package schemas", () => {
  it("keeps plugin company remote base URL ownership explicit", () => {
    expect(opencodeProjectSyncCompanySettingsSchema.parse({})).toEqual({
      remoteServerDefault: { mode: "unset" },
    });

    expect(opencodeProjectSyncCompanySettingsSchema.safeParse({
      remoteServerDefault: { mode: "fixed", baseUrl: "https://remote.example.com" },
    }).success).toBe(true);

    expect(opencodeProjectSyncCompanySettingsSchema.safeParse({
      remoteServerDefault: { mode: "fixed" },
    }).success).toBe(false);

    expect(opencodeProjectSyncCompanySettingsSchema.safeParse({
      remoteServerDefault: { mode: "per_agent", baseUrl: "https://remote.example.com" },
    }).success).toBe(false);
  });

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

  it("keeps planned agent adapter config narrow and bound to opencode_full", () => {
    const result = opencodeProjectFinalizeSyncInputSchema.safeParse({
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
        executionMode: "remote_server",
      }],
      appliedAgents: [{
        externalAgentKey: "researcher",
        paperclipAgentId: "33333333-3333-4333-8333-333333333333",
      }],
    });

    expect(result.success).toBe(false);
  });

  it("enforces top-level preview and agent-only conflict vocabulary", () => {
    expect(opencodeTopLevelAgentPreviewSchema.safeParse({
      lastScanFingerprint: "abc",
      eligibleAgents: [],
      ineligibleNestedAgents: [],
      ignoredArtifacts: [],
      warnings: [],
    }).success).toBe(true);

    expect(opencodeTopLevelAgentPreviewSchema.safeParse({
      lastScanFingerprint: "abc",
      eligibleAgents: [{
        externalAgentKey: "orchestrator",
        displayName: "Orchestrator",
        repoRelPath: ".opencode/agents/orchestrator.md",
        fingerprint: "fp",
        role: null,
        advisoryMode: null,
        selectionDefault: false,
        frontmatter: { model: "openai/gpt-5.4" },
      }],
      ineligibleNestedAgents: [],
      ignoredArtifacts: [],
      warnings: ["warn"],
    }).success).toBe(true);

    const parsedPreview = opencodeTopLevelAgentPreviewSchema.parse({
      lastScanFingerprint: "abc",
      eligibleAgents: [{
        externalAgentKey: "analyst",
        displayName: "Analyst",
        repoRelPath: ".opencode/agents/analyst.md",
        fingerprint: "fp-2",
        role: "Analyst",
        advisoryMode: null,
        selectionDefault: false,
        frontmatter: { model: null },
      }],
      ineligibleNestedAgents: [],
      ignoredArtifacts: [],
      warnings: [],
    });

    expect(parsedPreview.eligibleAgents[0]?.frontmatter.model).toBeNull();

    expect(opencodeTopLevelAgentPreviewSchema.safeParse({
      lastScanFingerprint: "abc",
      eligibleAgents: [{
        externalAgentKey: "broken",
        displayName: "Broken",
        repoRelPath: ".opencode/agents/broken.md",
        fingerprint: "fp-3",
        role: null,
        advisoryMode: null,
        selectionDefault: false,
      }],
      ineligibleNestedAgents: [],
      ignoredArtifacts: [],
      warnings: [],
    }).success).toBe(false);

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

  it("accepts planned upserts plus injected renderEnvironment during finalize", () => {
    const plannedUpsert = opencodeProjectPlannedAgentUpsertSchema.parse({
      operation: "create",
      paperclipAgentId: null,
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp",
      matchBasis: "new_agent",
      payload: {
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: {
          executionMode: "local_cli",
          model: "openai/gpt-5.4",
          promptTemplate: "# Researcher",
          localCli: {
            allowProjectConfig: true,
          },
        },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId: "22222222-2222-4222-8222-222222222222",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          repoRoot: "/repos/canonical",
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp",
          lastImportedAt: "2026-04-11T12:00:00.000Z",
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      },
    });

    expect(opencodeProjectFinalizeSyncInputSchema.safeParse({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      importedAt: "2026-04-11T12:00:00.000Z",
      lastScanFingerprint: "abc123",
      selectedAgentKeys: ["researcher"],
      warnings: [],
      agentUpserts: [plannedUpsert],
      appliedAgents: [{
        externalAgentKey: "researcher",
        paperclipAgentId: "44444444-4444-4444-8444-444444444444",
      }],
      renderEnvironment: {
        environment: "hostOverlay",
        launcherId: "opencode-project-sync",
        bounds: "default",
      },
    }).success).toBe(true);
  });

  it("rejects unexpected top-level finalize keys while allowing renderEnvironment", () => {
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
      unexpectedTopLevelField: true,
    }).success).toBe(false);
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

  it("rejects extra persisted sync identity fields beyond canonical workspace provenance", () => {
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
      remoteBaseUrl: "https://example.com/opencode",
    });

    expect(result.success).toBe(false);
  });

  it("accepts linked remote status payloads and keeps sync gating data explicit", () => {
    const result = opencodeProjectResolveRemoteModeStatusResultSchema.safeParse({
      canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
      canonicalRepoRoot: "/repos/canonical",
      companyBaseUrlDefault: "https://remote.example.com",
      remoteLink: {
        version: 2,
        status: "linked",
        baseUrl: "https://remote.example.com",
        serverScope: "shared",
        targetMode: "linked_project_context",
        canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
        canonicalRepoRoot: "/repos/canonical",
        linkedDirectoryHint: "/workspace/repo",
        projectEvidence: {
          projectId: "remote-project-1",
          projectName: "Forgebox",
          pathCwd: "/workspace/repo",
          repoRoot: "/workspace/repo",
          repoUrl: "https://github.com/acme/forgebox.git",
          repoRef: "main",
        },
        validatedAt: "2026-04-16T12:00:00.000Z",
        invalidatedAt: null,
        invalidReason: null,
        lastHealthOkAt: "2026-04-16T12:00:00.000Z",
        lastSyncAt: null,
        lastRunAt: null,
        propagatedToImportedAgentsAt: null,
      },
      syncAllowed: true,
      syncBlockReason: null,
    });

    expect(result.success).toBe(true);
  });

  it("accepts stale and broken remote link payloads in persisted sync state", () => {
    const staleState = opencodeProjectSyncStateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      canonicalRepoRoot: "/repos/canonical",
      canonicalRepoUrl: null,
      canonicalRepoRef: null,
      bootstrapCompletedAt: null,
      lastScanFingerprint: null,
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
      remoteLink: {
        version: 2,
        status: "stale",
        baseUrl: "https://remote.example.com",
        serverScope: "unknown",
        targetMode: "linked_project_context",
        canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
        canonicalRepoRoot: "/repos/canonical",
        linkedDirectoryHint: "/workspace/repo",
        projectEvidence: {
          projectId: null,
          projectName: "Forgebox",
          pathCwd: "/workspace/repo",
          repoRoot: "/workspace/repo",
          repoUrl: null,
          repoRef: null,
        },
        validatedAt: "2026-04-16T12:00:00.000Z",
        invalidatedAt: "2026-04-16T13:00:00.000Z",
        invalidReason: "Project evidence no longer matches the canonical repo intent.",
        lastHealthOkAt: "2026-04-16T12:30:00.000Z",
        lastSyncAt: null,
        lastRunAt: null,
        propagatedToImportedAgentsAt: "2026-04-16T12:05:00.000Z",
      },
    });

    const brokenState = opencodeProjectSyncStateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      canonicalRepoRoot: "/repos/canonical",
      canonicalRepoUrl: null,
      canonicalRepoRef: null,
      bootstrapCompletedAt: null,
      lastScanFingerprint: null,
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
      remoteLink: {
        version: 2,
        status: "broken",
        baseUrl: "https://remote.example.com",
        serverScope: "shared",
        targetMode: "linked_project_context",
        canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
        canonicalRepoRoot: "/repos/canonical",
        linkedDirectoryHint: "/workspace/repo",
        projectEvidence: {
          projectId: "remote-project-1",
          projectName: null,
          pathCwd: null,
          repoRoot: "/workspace/repo",
          repoUrl: null,
          repoRef: null,
        },
        validatedAt: "2026-04-16T12:00:00.000Z",
        invalidatedAt: "2026-04-16T13:00:00.000Z",
        invalidReason: "Remote validation probe failed.",
        lastHealthOkAt: null,
        lastSyncAt: null,
        lastRunAt: null,
        propagatedToImportedAgentsAt: null,
      },
    });

    expect(staleState.success).toBe(true);
    expect(brokenState.success).toBe(true);
  });

  it("stays backward-aware by defaulting missing remoteLink to null", () => {
    const parsed = opencodeProjectSyncStateSchema.parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      canonicalRepoRoot: "/repos/canonical",
      canonicalRepoUrl: null,
      canonicalRepoRef: null,
      bootstrapCompletedAt: null,
      lastScanFingerprint: null,
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
    });

    expect(parsed.remoteLink).toBeNull();
  });

  it("rejects malformed or out-of-scope remote link payloads", () => {
    expect(opencodeProjectLinkRemoteContextResultSchema.safeParse({
      remoteLink: {
        version: 2,
        status: "linked",
        baseUrl: "not-a-url",
        serverScope: "shared",
        targetMode: "linked_project_context",
        canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
        canonicalRepoRoot: "/repos/canonical",
        linkedDirectoryHint: "/workspace/repo",
        projectEvidence: {
          projectId: "remote-project-1",
          projectName: "Forgebox",
          pathCwd: "/workspace/repo",
          repoRoot: "/workspace/repo",
          repoUrl: null,
          repoRef: null,
        },
        validatedAt: "2026-04-16T12:00:00.000Z",
        invalidatedAt: null,
        invalidReason: null,
        lastHealthOkAt: null,
        lastSyncAt: null,
        lastRunAt: null,
        propagatedToImportedAgentsAt: null,
      },
      warnings: [],
      updatedImportedAgentCount: 1,
    }).success).toBe(false);

    expect(opencodeProjectLinkRemoteContextResultSchema.safeParse({
      remoteLink: {
        version: 2,
        status: "linked",
        baseUrl: "https://remote.example.com",
        serverScope: "shared",
        targetMode: "workspace_runtime",
        canonicalWorkspaceId: "22222222-2222-4222-8222-222222222222",
        canonicalRepoRoot: "/repos/canonical",
        linkedDirectoryHint: "/workspace/repo",
        projectEvidence: {
          projectId: "remote-project-1",
          projectName: "Forgebox",
          pathCwd: "/workspace/repo",
          repoRoot: "/workspace/repo",
          repoUrl: null,
          repoRef: null,
        },
        validatedAt: "2026-04-16T12:00:00.000Z",
        invalidatedAt: null,
        invalidReason: null,
        lastHealthOkAt: null,
        lastSyncAt: null,
        lastRunAt: null,
        propagatedToImportedAgentsAt: null,
      },
      warnings: [],
      updatedImportedAgentCount: 1,
    }).success).toBe(false);

    expect(opencodeProjectClearRemoteLinkResultSchema.safeParse({
      cleared: false,
      updatedImportedAgentCount: 0,
    }).success).toBe(false);
  });
});

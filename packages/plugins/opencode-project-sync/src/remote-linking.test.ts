import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest, {
  OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY,
  OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY,
  OPENCODE_PROJECT_RESOLVE_REMOTE_MODE_STATUS_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
} from "./manifest.js";
import plugin from "./plugin.js";
import {
  OPENCODE_PROJECT_SYNC_STATE_KEY,
  OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
  OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
} from "./sync-state.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const repoRoot = process.cwd();

function makeProject() {
  return {
    id: projectId,
    companyId,
    urlKey: "opencode-project",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "OpenCode Project",
    description: null,
    status: "in_progress" as const,
    leadAgentId: null,
    targetDate: null,
    color: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId,
      repoUrl: "https://example.com/acme/repo.git",
      repoRef: "main",
      defaultRef: "main",
      repoName: "repo",
      localFolder: repoRoot,
      managedFolder: repoRoot,
      effectiveLocalFolder: repoRoot,
      origin: "local_folder",
    },
    workspaces: [{
      id: workspaceId,
      companyId,
      projectId,
      name: "Primary",
      sourceType: "git_repo",
      cwd: repoRoot,
      repoUrl: "https://example.com/acme/repo.git",
      repoRef: "main",
      defaultRef: "main",
      visibility: "default",
      setupCommand: null,
      cleanupCommand: null,
      remoteProvider: null,
      remoteWorkspaceRef: null,
      sharedWorkspaceKey: null,
      metadata: null,
      runtimeConfig: null,
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
    primaryWorkspace: {
      id: workspaceId,
      companyId,
      projectId,
      name: "Primary",
      sourceType: "git_repo",
      cwd: repoRoot,
      repoUrl: "https://example.com/acme/repo.git",
      repoRef: "main",
      defaultRef: "main",
      visibility: "default",
      setupCommand: null,
      cleanupCommand: null,
      remoteProvider: null,
      remoteWorkspaceRef: null,
      sharedWorkspaceKey: null,
      metadata: null,
      runtimeConfig: null,
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

function makeManagedAgent(adapterConfig: Record<string, unknown> | null = {
  executionMode: "remote_server",
  model: "openai/gpt-5.4",
  promptTemplate: "# Researcher\n",
  remoteServer: {
    baseUrl: "https://remote.example.com",
    auth: { mode: "none" },
    projectTarget: { mode: "server_default" },
  },
}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    companyId,
    name: "Researcher",
    description: null,
    systemPrompt: null,
    model: null,
    status: "idle",
    priority: 0,
    role: "worker",
    isDefault: false,
    budgetWindow: "monthly",
    budgetTokens: null,
    budgetDollars: null,
    budgetMinutes: null,
    spentTokens: 0,
    spentDollars: 0,
    spentMinutes: 0,
    adapterType: "opencode_full",
    adapterConfig,
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
      lastImportedFingerprint: null,
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    pausedAt: null,
    pauseReason: null,
    terminatedAt: null,
    terminationReason: null,
    archivedAt: null,
    archivedByUserId: null,
    approvedAt: null,
    approvedByUserId: null,
    approvalStatus: "approved",
    approvalRequestId: null,
    currentTaskId: null,
    currentIssueId: null,
    iconName: null,
    schedule: null,
    env: null,
    tools: null,
    workspaceId: null,
    reportsTo: null,
    title: "Lead researcher",
  } as any;
}

function makeSyncState(remoteLink: Record<string, unknown> | null) {
  return {
    projectId,
    workspaceId,
    canonicalRepoRoot: repoRoot,
    canonicalRepoUrl: "https://example.com/acme/repo.git",
    canonicalRepoRef: "main",
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
    importedAgents: [{
      paperclipAgentId: "55555555-5555-4555-8555-555555555555",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentName: "Researcher",
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }],
    warnings: [],
    conflicts: [],
    remoteLink,
  };
}

describe("remote linking lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/global/health")) return new Response(JSON.stringify({ serverScope: "shared" }), { status: 200 });
      if (url.endsWith("/project/current")) return new Response(JSON.stringify({ id: "remote-project", name: "Remote Forgebox" }), { status: 200 });
      if (url.endsWith("/path")) return new Response(JSON.stringify({ cwd: "/remote/repo", repoRoot: "/remote/repo" }), { status: 200 });
      if (url.endsWith("/vcs")) return new Response(JSON.stringify({ repoUrl: "https://example.com/acme/repo.git", repoRef: "main" }), { status: 200 });
      if (url.includes("/session?directory=")) return new Response(JSON.stringify({ sessionId: "session-1" }), { status: 200 });
      if (url.includes("http://127.0.0.1:3100/api/agents/")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves project-level remote status with sync gating", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities], config: { remoteServerDefault: { mode: "fixed", baseUrl: "https://remote.example.com" } } });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any], projects: [makeProject()] });
    await harness.ctx.state.set({ scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND, scopeId: workspaceId, namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE, stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY }, makeSyncState({
      version: 2,
      status: "stale",
      baseUrl: "https://remote.example.com",
      serverScope: "shared",
      targetMode: "linked_project_context",
      canonicalWorkspaceId: workspaceId,
      canonicalRepoRoot: repoRoot,
      linkedDirectoryHint: "/remote/repo",
      projectEvidence: { projectId: "remote-project", projectName: "Remote Forgebox", pathCwd: "/remote/repo", repoRoot: "/remote/repo", repoUrl: "https://example.com/acme/repo.git", repoRef: "main" },
      validatedAt: "2026-04-16T12:00:00.000Z",
      invalidatedAt: "2026-04-16T12:30:00.000Z",
      invalidReason: "Remote link is stale.",
      lastHealthOkAt: null,
      lastSyncAt: null,
      lastRunAt: null,
      propagatedToImportedAgentsAt: null,
    }));

    const dataResult = await harness.getData<any>(OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY, { companyId, projectId });
    const actionResult = await harness.performAction<any>(OPENCODE_PROJECT_RESOLVE_REMOTE_MODE_STATUS_ACTION_KEY, { companyId, projectId });
    expect(dataResult).toEqual(actionResult);
    expect(actionResult.syncAllowed).toBe(false);
    expect(actionResult.syncBlockReason).toBe("Remote link is stale.");
  });

  it("links and propagates derived linked config before success", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities], config: { remoteServerDefault: { mode: "fixed", baseUrl: "https://remote.example.com" } } });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any], projects: [makeProject()], agents: [makeManagedAgent()] });
    await harness.ctx.state.set({ scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND, scopeId: workspaceId, namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE, stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY }, makeSyncState(null));

    const result = await harness.performAction<any>(OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY, { companyId, projectId });
    expect(result.updatedImportedAgentCount).toBe(1);
    expect(result.remoteLink.status).toBe("linked");
    expect(result.remoteLink.linkedDirectoryHint).toBe("/remote/repo");
  });

  it("marks refresh stale on repo mismatch and blocks sync", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/global/health")) return new Response(JSON.stringify({ serverScope: "shared" }), { status: 200 });
      if (url.endsWith("/project/current")) return new Response(JSON.stringify({ id: "remote-project", name: "Remote Forgebox" }), { status: 200 });
      if (url.endsWith("/path")) return new Response(JSON.stringify({ cwd: "/remote/repo", repoRoot: "/remote/repo" }), { status: 200 });
      if (url.endsWith("/vcs")) return new Response(JSON.stringify({ repoUrl: "https://example.com/other/repo.git", repoRef: "main" }), { status: 200 });
      if (url.includes("/session?directory=")) return new Response(JSON.stringify({ sessionId: "session-1" }), { status: 200 });
      if (url.includes("http://127.0.0.1:3100/api/agents/")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any], projects: [makeProject()] });
    await harness.ctx.state.set({ scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND, scopeId: workspaceId, namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE, stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY }, makeSyncState({
      version: 2,
      status: "linked",
      baseUrl: "https://remote.example.com",
      serverScope: "shared",
      targetMode: "linked_project_context",
      canonicalWorkspaceId: workspaceId,
      canonicalRepoRoot: repoRoot,
      linkedDirectoryHint: "/remote/repo",
      projectEvidence: { projectId: "remote-project", projectName: "Remote Forgebox", pathCwd: "/remote/repo", repoRoot: "/remote/repo", repoUrl: "https://example.com/acme/repo.git", repoRef: "main" },
      validatedAt: "2026-04-16T12:00:00.000Z",
      invalidatedAt: null,
      invalidReason: null,
      lastHealthOkAt: "2026-04-16T12:00:00.000Z",
      lastSyncAt: null,
      lastRunAt: null,
      propagatedToImportedAgentsAt: null,
    }));

    const refreshed = await harness.performAction<any>(OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY, { companyId, projectId });
    expect(refreshed.remoteLink.status).toBe("stale");
    await expect(harness.performAction<any>(OPENCODE_PROJECT_SYNC_ACTION_KEY, { companyId, projectId, mode: "import", dryRun: false, selectedAgentKeys: [] }))
      .rejects.toThrow(/REMOTE_LINK_REPO_MISMATCH/i);
  });

  it("clears and propagates server_default reset", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any], projects: [makeProject()], agents: [makeManagedAgent({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      promptTemplate: "# Researcher\n",
      remoteServer: {
        baseUrl: "https://remote.example.com",
        auth: { mode: "none" },
        projectTarget: { mode: "linked_project_context" },
        linkRef: { linkedDirectoryHint: "/remote/repo" },
      },
    })] });
    await harness.ctx.state.set({ scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND, scopeId: workspaceId, namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE, stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY }, makeSyncState({
      version: 2,
      status: "linked",
      baseUrl: "https://remote.example.com",
      serverScope: "shared",
      targetMode: "linked_project_context",
      canonicalWorkspaceId: workspaceId,
      canonicalRepoRoot: repoRoot,
      linkedDirectoryHint: "/remote/repo",
      projectEvidence: { projectId: "remote-project", projectName: "Remote Forgebox", pathCwd: "/remote/repo", repoRoot: "/remote/repo", repoUrl: "https://example.com/acme/repo.git", repoRef: "main" },
      validatedAt: "2026-04-16T12:00:00.000Z",
      invalidatedAt: null,
      invalidReason: null,
      lastHealthOkAt: "2026-04-16T12:00:00.000Z",
      lastSyncAt: null,
      lastRunAt: null,
      propagatedToImportedAgentsAt: null,
    }));

    const result = await harness.performAction<any>(OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY, { companyId, projectId });
    expect(result).toEqual({ cleared: true, updatedImportedAgentCount: 1 });
  });

  it("fails on partial propagation errors", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any], projects: [makeProject()], agents: [makeManagedAgent(null)] });
    await harness.ctx.state.set({ scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND, scopeId: workspaceId, namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE, stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY }, makeSyncState(null));

    await expect(harness.performAction<any>(OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY, { companyId, projectId, baseUrl: "https://remote.example.com" }))
      .rejects.toThrow(/REMOTE_LINK_PROPAGATION_FAILED/);
  });
});

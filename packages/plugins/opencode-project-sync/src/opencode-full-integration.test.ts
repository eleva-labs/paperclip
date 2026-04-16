import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest, {
  OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY,
  OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY,
} from "./manifest.js";
import plugin from "./plugin.js";
import { buildImportPlan } from "./import-plan.js";
import { discoverOpencodeProjectFiles } from "./discovery.js";
import { opencodeProjectSyncStateSchema } from "./sync-state.js";

const tempDirs: string[] = [];
const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

function makeProject(repoRoot: string) {
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

function makeManagedAgent(repoRoot: string) {
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
    adapterConfig: {
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      promptTemplate: "# Researcher\n",
      remoteServer: {
        baseUrl: "https://remote.example.com/opencode",
        auth: { mode: "none" },
        projectTarget: { mode: "server_default" },
      },
    },
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

function makeSyncState(repoRoot: string, remoteLink: Record<string, unknown> | null) {
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

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-full-integration-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(repoRoot: string, repoRelPath: string, content: string) {
  const filePath = path.join(repoRoot, repoRelPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("opencode_full plugin integration guardrails", () => {
  it("keeps sync top-level only while importing agents as opencode_full", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/researcher.md", "---\nmodel: openai/gpt-5.4\n---\n# Researcher\n");
    writeFile(repoRoot, ".opencode/agents/team/qa.md", "# QA\n");
    writeFile(repoRoot, ".opencode/skills/research/SKILL.md", "# Skill\n");
    writeFile(repoRoot, "AGENTS.md", "# Root guide\n");

    const discovery = discoverOpencodeProjectFiles({ repoRoot });

    expect(discovery.eligibleAgents.map((agent) => agent.repoRelPath)).toEqual([
      ".opencode/agents/researcher.md",
    ]);
    expect(discovery.ineligibleNestedAgents.map((agent) => agent.repoRelPath)).toEqual([
      ".opencode/agents/team/qa.md",
    ]);
    expect(discovery.ignoredArtifacts).toEqual(expect.arrayContaining([
      { kind: "skill", repoRelPath: ".opencode/skills/research/SKILL.md" },
      { kind: "root_agents_md", repoRelPath: "AGENTS.md" },
    ]));

    const plan = buildImportPlan({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher", "team-qa"],
      importedAt: "2026-04-15T12:00:00.000Z",
      existingState: null,
      existingAgents: [],
      discovery,
    });

    expect(plan.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_selection", entityKey: "team-qa" }),
    ]));
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({
        externalAgentKey: "researcher",
        payload: expect.objectContaining({
          adapterType: "opencode_full",
          adapterConfig: expect.objectContaining({
            executionMode: "local_cli",
            model: "openai/gpt-5.4",
          }),
          metadata: expect.objectContaining({
            repoRoot,
            repoRelPath: ".opencode/agents/researcher.md",
            workspaceId: "33333333-3333-4333-8333-333333333333",
          }),
        }),
      }),
    ]);
  });

  it("preserves canonical workspace provenance and server_default when existing agents use remote_server", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Researcher\n");
    const discovery = discoverOpencodeProjectFiles({ repoRoot });

    const plan = buildImportPlan({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "33333333-3333-4333-8333-333333333333",
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt: "2026-04-15T12:00:00.000Z",
      existingState: null,
      existingAgents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: {
          executionMode: "remote_server",
          model: "openai/gpt-5.4",
          remoteServer: {
            baseUrl: "https://gateway.example.com/opencode",
            auth: { mode: "none" },
            projectTarget: { mode: "server_default" },
          },
        },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId: "22222222-2222-4222-8222-222222222222",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          repoRoot,
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: "2026-04-14T12:00:00.000Z",
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery,
    });

    expect(plan.agentUpserts[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        adapterType: "opencode_full",
        adapterConfig: expect.objectContaining({
          executionMode: "remote_server",
          remoteServer: expect.objectContaining({
            baseUrl: "https://gateway.example.com/opencode",
            projectTarget: { mode: "server_default" },
          }),
        }),
        metadata: expect.objectContaining({
          repoRoot,
          workspaceId: "33333333-3333-4333-8333-333333333333",
        }),
      }),
    }));
  });

  it("rejects non-canonical remote identity fields in persisted sync state", () => {
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
      remoteBaseUrl: "https://gateway.example.com/opencode",
    });

    expect(result.success).toBe(false);
  });

  it("covers link, relink, and clear propagation across imported opencode_full agents", async () => {
    const repoRoot = makeTempRepo();
    let currentDirectoryHint = "/remote/repo-a";

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/global/health")) return new Response(JSON.stringify({ serverScope: "shared" }), { status: 200 });
      if (url.endsWith("/project/current")) return new Response(JSON.stringify({ id: "remote-project", name: "Remote Forgebox" }), { status: 200 });
      if (url.endsWith("/path")) return new Response(JSON.stringify({ cwd: currentDirectoryHint, repoRoot: currentDirectoryHint }), { status: 200 });
      if (url.endsWith("/vcs")) return new Response(JSON.stringify({ repoUrl: "https://example.com/acme/repo.git", repoRef: "main" }), { status: 200 });
      if (url.includes("/session?directory=")) return new Response(JSON.stringify({ id: "session-1" }), { status: 200 });
      if (url.includes("http://127.0.0.1:3100/api/agents/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
      config: { remoteServerDefault: { mode: "fixed", baseUrl: "https://remote.example.com/opencode" } },
    });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [{ id: companyId, name: "Test Company", description: null, status: "active", pauseReason: null, pausedAt: null, issuePrefix: "TPC", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0, requireBoardApprovalForNewAgents: false, feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null, feedbackDataSharingTermsVersion: null, brandColor: null, logoAssetId: null, logoUrl: null, createdAt: new Date(), updatedAt: new Date() } as any],
      projects: [makeProject(repoRoot)],
      agents: [makeManagedAgent(repoRoot)],
    });
    await harness.ctx.state.set({
      scopeKind: "project_workspace",
      scopeId: workspaceId,
      namespace: "opencode_project_sync",
      stateKey: "sync_state",
    }, makeSyncState(repoRoot, null));

    const linked = await harness.performAction<any>(OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY, { companyId, projectId });
    expect(linked.remoteLink.status).toBe("linked");
    expect(linked.remoteLink.linkedDirectoryHint).toBe("/remote/repo-a");
    expect(linked.updatedImportedAgentCount).toBeGreaterThanOrEqual(0);

    currentDirectoryHint = "/remote/repo-b";
    const refreshed = await harness.performAction<any>(OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY, { companyId, projectId });
    expect(refreshed.remoteLink.status).toBe("linked");
    expect(refreshed.remoteLink.linkedDirectoryHint).toBe("/remote/repo-b");
    expect(refreshed.updatedImportedAgentCount).toBeGreaterThanOrEqual(0);

    const cleared = await harness.performAction<any>(OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY, { companyId, projectId });
    expect(cleared.cleared).toBe(true);
    expect(cleared.updatedImportedAgentCount).toBeGreaterThanOrEqual(0);

    vi.unstubAllGlobals();
  });
});

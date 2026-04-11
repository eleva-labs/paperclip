import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent, Company, Project } from "@paperclipai/plugin-sdk";
import manifest, {
  OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
  OPENCODE_PROJECT_EXPORT_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_HOST_CONTRACT_DATA_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_STATE_DATA_KEY,
  OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID,
  OPENCODE_PROJECT_SYNC_SIDEBAR_ITEM_ID,
  OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_TOOLBAR_BUTTON_ID,
} from "../src/manifest.js";
import plugin from "../src/plugin.js";
import {
  OPENCODE_PROJECT_SYNC_STATE_KEY,
  OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
  OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
} from "../src/sync-state.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-project-plugin-"));
  tempDirs.push(dir);
  return dir;
}

function writeFile(repoRoot: string, repoRelPath: string, content: string) {
  const filePath = path.join(repoRoot, repoRelPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const company: Company = {
  id: companyId,
  name: "Test Company",
  description: null,
  status: "active",
  pauseReason: null,
  pausedAt: null,
  issuePrefix: "TPC",
  issueCounter: 1,
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  requireBoardApprovalForNewAgents: false,
  feedbackDataSharingEnabled: false,
  feedbackDataSharingConsentAt: null,
  feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null,
  brandColor: null,
  logoAssetId: null,
  logoUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeProject(repoRoot: string): Project {
  return {
    id: projectId,
    companyId,
    urlKey: "opencode-project",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "OpenCode Project",
    description: null,
    status: "in_progress",
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
  };
}

function makeManagedAgent(repoRoot: string): Agent {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    companyId,
    name: "Researcher",
    urlKey: "researcher",
    role: "general",
    title: "Lead researcher",
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    metadata: {
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      sourceOfTruth: "repo_first",
      projectId,
      workspaceId,
      repoRoot,
      repoRelPath: ".opencode/agents/researcher.md",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentKey: "researcher",
      externalAgentName: "Researcher",
      folderPath: null,
      hierarchyMode: "metadata_only",
      reportsToExternalKey: null,
      desiredSkillKeys: ["research"],
      lastImportedFingerprint: "fp-agent-1",
      lastImportedAt: "2026-04-11T12:00:00.000Z",
      lastExportedFingerprint: null,
      lastExportedAt: null,
    },
    adapterType: "opencode_project_local",
    adapterConfig: { promptTemplate: "# Researcher\n", allowProjectConfig: true },
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("opencode project sync scaffold", () => {
  it("registers foundation data/actions and declares project ui surfaces", async () => {
    const repoRoot = makeTempRepo();
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [company], projects: [makeProject(repoRoot)] });

    const hostContract = await harness.getData<{
      transport: string;
      endpoints: { createAgent: string; createCompanySkill: string };
    }>(OPENCODE_PROJECT_SYNC_HOST_CONTRACT_DATA_KEY);

    expect(hostContract.transport).toBe("paperclip_rest_api_v1");
    expect(hostContract.endpoints.createAgent).toBe("/companies/:companyId/agents");
    expect(hostContract.endpoints.createCompanySkill).toBe("/companies/:companyId/skills");

    const stateData = await harness.getData<{ workspace: { workspaceId: string } }>(
      OPENCODE_PROJECT_SYNC_STATE_DATA_KEY,
      { companyId, projectId },
    );
    expect(stateData.workspace.workspaceId).toBe(workspaceId);

    const bootstrap = await harness.performAction<{ ok: boolean; workspaceId: string }>(
      OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
      { companyId, projectId },
    );
    expect(bootstrap.ok).toBe(true);
    expect(bootstrap.workspaceId).toBe(workspaceId);

    expect(manifest.ui?.slots?.map((slot: { id: string }) => slot.id)).toEqual([
      OPENCODE_PROJECT_SYNC_TOOLBAR_BUTTON_ID,
      OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID,
      OPENCODE_PROJECT_SYNC_SIDEBAR_ITEM_ID,
    ]);
  });

  it("logs import mutations, runtime-test state, and guarded export refusals", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, "AGENTS.md", "# Repository Guide\n");
    writeFile(repoRoot, ".opencode/skills/research/SKILL.md", "# Research\n");
    writeFile(
      repoRoot,
      ".opencode/agents/researcher.md",
      "---\nname: Researcher\ndesiredSkills:\n  - research\n---\n# Researcher\n",
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith(`/companies/${companyId}/skills`) && method === "GET") {
        return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/companies/${companyId}/skills`) && method === "POST") {
        return new Response(JSON.stringify({ id: "skill-created-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/companies/${companyId}/skills/skill-created-1`) && method === "GET") {
        return new Response(JSON.stringify({ id: "skill-created-1", key: "research", slug: "research", name: "Research", markdown: "# Research\n" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/companies/${companyId}/skills/skill-created-1/files`) && method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/companies/${companyId}/agents`) && method === "POST") {
        return new Response(JSON.stringify({ id: "agent-created-1" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith(`/agents/agent-created-1`) && method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(`/agents/agent-created-1/skills/sync`) && method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [company], projects: [makeProject(repoRoot)] });

    const syncResult = await harness.performAction<{ ok: true; importedAgentCount: number; importedSkillCount: number }>(
      OPENCODE_PROJECT_SYNC_ACTION_KEY,
      { companyId, projectId, mode: "import", dryRun: false },
    );

    expect(syncResult.ok).toBe(true);
    expect(syncResult.importedAgentCount).toBe(1);
    expect(syncResult.importedSkillCount).toBe(2);
    expect(harness.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "OpenCode import sync completed",
        entityType: "project",
        entityId: projectId,
        metadata: expect.objectContaining({
          pluginId: manifest.id,
          workspaceId,
          importedAgentCount: 1,
        }),
      }),
    ]));

    const runtimeResult = await harness.performAction<{ ok: boolean; message: string }>(
      OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY,
      { companyId, projectId, agentId: "agent-created-1" },
    );
    expect(runtimeResult.ok).toBe(false);
    expect(runtimeResult.message).toContain("not wired through this plugin action yet");
    expect(harness.getState({
      scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
      scopeId: workspaceId,
      namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
      stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY,
    })).toEqual(expect.objectContaining({
      lastRuntimeTestAt: expect.any(String),
      lastRuntimeTestResult: expect.objectContaining({ ok: false }),
    }));

    writeFile(repoRoot, ".opencode/skills/research/notes.md", "drift\n");
    await expect(harness.performAction(OPENCODE_PROJECT_EXPORT_ACTION_KEY, {
      companyId,
      projectId,
      exportAgents: true,
      exportSkills: true,
    })).rejects.toThrow(/OpenCode export blocked/i);

    expect(harness.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("OpenCode export blocked:"),
        entityType: "project",
        entityId: projectId,
        metadata: expect.objectContaining({
          pluginId: manifest.id,
          workspaceId,
          conflicts: expect.arrayContaining([
            expect.objectContaining({ code: "repo_changed_since_last_import" }),
          ]),
        }),
      }),
    ]));

    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects malformed persisted sync state before mutating", async () => {
    const repoRoot = makeTempRepo();
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company],
      projects: [makeProject(repoRoot)],
      agents: [makeManagedAgent(repoRoot)],
    });
    await harness.ctx.state.set({
      scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
      scopeId: workspaceId,
      namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
      stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY,
    }, {
      projectId,
      workspaceId,
      sourceOfTruth: "repo_first",
      canonicalRepoRoot: repoRoot,
      manifestVersion: 999,
      importedAgents: [],
      importedSkills: [],
      warnings: [],
      conflicts: [],
    });

    await expect(harness.performAction(OPENCODE_PROJECT_SYNC_ACTION_KEY, {
      companyId,
      projectId,
      mode: "import",
      dryRun: false,
    })).rejects.toThrow(/stored OpenCode project sync state is invalid/i);
  });
});

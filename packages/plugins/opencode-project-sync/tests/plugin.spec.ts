import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Company, Project } from "@paperclipai/plugin-sdk";
import manifest, {
  OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
  OPENCODE_PROJECT_EXPORT_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY,
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

describe("opencode project sync plugin cycle 2.1", () => {
  it("returns an import plan without mutating host agents", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".git/HEAD", "ref: refs/heads/main\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "---\nname: Researcher\nrole: Lead researcher\n---\n# Researcher\n");

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [company], projects: [makeProject(repoRoot)] });

    await harness.performAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, { companyId, projectId });
    const beforeAgents = await harness.ctx.agents.list({ companyId });

    const plan = await harness.performAction<any>(OPENCODE_PROJECT_SYNC_ACTION_KEY, {
      companyId,
      projectId,
      mode: "import",
      dryRun: false,
      selectedAgentKeys: ["researcher"],
    });

    expect(plan.ok).toBe(true);
    expect(plan.skillUpserts).toEqual([]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({
        operation: "create",
        externalAgentKey: "researcher",
        matchBasis: "new_agent",
        payload: expect.objectContaining({
          reportsTo: null,
          metadata: expect.objectContaining({
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            repoRelPath: ".opencode/agents/researcher.md",
            workspaceId,
            projectId,
          }),
        }),
      }),
    ]);
    expect(await harness.ctx.agents.list({ companyId })).toEqual(beforeAgents);
  });

  it("finalize persists only selected facade manifests and preserves the selected set", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".git/HEAD", "ref: refs/heads/main\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Researcher\n");
    writeFile(repoRoot, ".opencode/agents/writer.md", "# Writer\n");

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company],
      projects: [makeProject(repoRoot)],
    });

    await harness.performAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, { companyId, projectId });
    const plan = await harness.performAction<any>(OPENCODE_PROJECT_SYNC_ACTION_KEY, {
      companyId,
      projectId,
      mode: "import",
      dryRun: false,
      selectedAgentKeys: ["researcher"],
    });

    const finalized = await harness.performAction<any>(OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY, {
      companyId,
      projectId,
      workspaceId: plan.workspaceId,
      importedAt: "2026-04-11T12:34:56.000Z",
      lastScanFingerprint: plan.lastScanFingerprint,
      selectedAgentKeys: ["researcher"],
      warnings: plan.warnings,
      agentUpserts: plan.agentUpserts.map((entry: any) => ({
        operation: entry.operation,
        paperclipAgentId: entry.paperclipAgentId,
        externalAgentKey: entry.externalAgentKey,
        repoRelPath: entry.repoRelPath,
        fingerprint: entry.fingerprint,
      })),
      appliedAgents: [{ externalAgentKey: "researcher", paperclipAgentId: "55555555-5555-4555-8555-555555555555" }],
    });

    expect(finalized.ok).toBe(true);
    expect(finalized.importedAgentCount).toBe(1);
    expect(finalized.importedSkillCount).toBe(0);

    const state = harness.getState({
      scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
      scopeId: workspaceId,
      namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
      stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY,
    }) as any;

    expect(state.selectedAgents).toEqual([
      expect.objectContaining({ externalAgentKey: "researcher", repoRelPath: ".opencode/agents/researcher.md" }),
    ]);
    expect(state.importedAgents).toEqual([
      expect.objectContaining({
        paperclipAgentId: "55555555-5555-4555-8555-555555555555",
        externalAgentKey: "researcher",
        repoRelPath: ".opencode/agents/researcher.md",
      }),
    ]);
    expect(state.legacyOutOfScopeEntities).toBeUndefined();
  });

  it("rejects finalize payloads that include unselected agents", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".git/HEAD", "ref: refs/heads/main\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Researcher\n");
    writeFile(repoRoot, ".opencode/agents/writer.md", "# Writer\n");

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company],
      projects: [makeProject(repoRoot)],
    });

    await harness.performAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, { companyId, projectId });

    await expect(harness.performAction<any>(OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY, {
      companyId,
      projectId,
      workspaceId,
      importedAt: "2026-04-11T12:34:56.000Z",
      lastScanFingerprint: "scan-1",
      selectedAgentKeys: ["researcher"],
      warnings: [],
      agentUpserts: [
        {
          operation: "create",
          paperclipAgentId: null,
          externalAgentKey: "researcher",
          repoRelPath: ".opencode/agents/researcher.md",
          fingerprint: "fp-researcher",
        },
        {
          operation: "create",
          paperclipAgentId: null,
          externalAgentKey: "writer",
          repoRelPath: ".opencode/agents/writer.md",
          fingerprint: "fp-writer",
        },
      ],
      appliedAgents: [
        { externalAgentKey: "researcher", paperclipAgentId: "55555555-5555-4555-8555-555555555555" },
        { externalAgentKey: "writer", paperclipAgentId: "66666666-6666-4666-8666-666666666666" },
      ],
    })).rejects.toThrow(/outside the selected eligible top-level set/i);
  });

  it("exports only selected managed top-level agents and leaves root/skill files untouched", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".git/HEAD", "ref: refs/heads/main\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "---\nname: Researcher\nmode: subagent\n---\n# Original\n");
    writeFile(repoRoot, ".opencode/agents/writer.md", "# Writer\n");
    writeFile(repoRoot, "AGENTS.md", "# Root agents\n");
    writeFile(repoRoot, ".opencode/skills/demo/SKILL.md", "# Skill\n");

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({
      companies: [company],
      projects: [makeProject(repoRoot)],
      agents: [{
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
        adapterType: "opencode_project_local",
        adapterConfig: { promptTemplate: "# Updated from Paperclip\n" },
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
      } as any],
    });

    await harness.performAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, { companyId, projectId });
    const plan = await harness.performAction<any>(OPENCODE_PROJECT_SYNC_ACTION_KEY, {
      companyId,
      projectId,
      mode: "import",
      dryRun: false,
      selectedAgentKeys: ["researcher"],
    });
    await harness.performAction<any>(OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY, {
      companyId,
      projectId,
      workspaceId: plan.workspaceId,
      importedAt: "2026-04-11T12:34:56.000Z",
      lastScanFingerprint: plan.lastScanFingerprint,
      selectedAgentKeys: ["researcher"],
      warnings: plan.warnings,
      agentUpserts: plan.agentUpserts.map((entry: any) => ({
        operation: entry.operation,
        paperclipAgentId: entry.paperclipAgentId,
        externalAgentKey: entry.externalAgentKey,
        repoRelPath: entry.repoRelPath,
        fingerprint: entry.fingerprint,
      })),
      appliedAgents: [{ externalAgentKey: "researcher", paperclipAgentId: "55555555-5555-4555-8555-555555555555" }],
    });

    const result = await harness.performAction<any>(OPENCODE_PROJECT_EXPORT_ACTION_KEY, {
      companyId,
      projectId,
      exportAgents: true,
      forceIfRepoUnchangedCheckFails: true,
    });

    expect(result.ok).toBe(true);
    expect(result.writtenFiles).toEqual([".opencode/agents/researcher.md"]);
    expect(fs.readFileSync(path.join(repoRoot, ".opencode/agents/researcher.md"), "utf8")).toBe(
      "---\nname: Researcher\nmode: subagent\n---\n# Updated from Paperclip\n",
    );
    expect(fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8")).toBe("# Root agents\n");
    expect(fs.readFileSync(path.join(repoRoot, ".opencode/skills/demo/SKILL.md"), "utf8")).toBe("# Skill\n");
  });

  it("blocks export when repo drift would overwrite unknown edits", async () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".git/HEAD", "ref: refs/heads/main\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Researcher\n");

    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
    await plugin.definition.setup(harness.ctx);
    harness.seed({ companies: [company], projects: [makeProject(repoRoot)] });

    await harness.performAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, { companyId, projectId });
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Changed after import\n");

    await expect(harness.performAction<any>(OPENCODE_PROJECT_EXPORT_ACTION_KEY, {
      companyId,
      projectId,
      exportAgents: true,
      forceIfRepoUnchangedCheckFails: false,
    })).rejects.toThrow(/changed since the last import/i);
  });
});

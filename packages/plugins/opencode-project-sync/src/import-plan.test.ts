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
    sourceOfTruth: "repo_first",
    bootstrapCompletedAt: null,
    canonicalRepoRoot: repoRoot,
    canonicalRepoUrl: "https://example.com/acme/repo.git",
    canonicalRepoRef: "main",
    lastScanFingerprint: "scan-1",
    lastScanCommit: null,
    lastImportedAt: null,
    lastExportedAt: null,
    lastRuntimeTestAt: null,
    lastRuntimeTestResult: null,
    manifestVersion: 1,
    importedAgents: [],
    importedSkills: [],
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
    state.importedSkills = [{
      paperclipSkillId: "skill-1",
      externalSkillKey: "research",
      repoRelPath: ".opencode/skills/research/SKILL.md",
      fingerprint: "fp-skill-old",
      canonicalLocator: `${repoRoot}::.opencode/skills/research/SKILL.md`,
      externalSkillName: "Research",
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
      importedAt,
      existingState: state,
      existingSkills: [{ id: "skill-1", key: "research", slug: "research", name: "Research" }],
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
          lastImportedFingerprint: "fp-agent-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        skills: [{
          externalSkillKey: "research",
          displayName: "Research",
          repoRelPath: ".opencode/skills/research/SKILL.md",
          markdown: "# Research\n",
          fileInventory: [{ path: ".opencode/skills/research/SKILL.md", kind: "skill" }],
          fingerprint: "fp-skill-new",
        }],
        agents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: "Lead researcher",
          repoRelPath: ".opencode/agents/researcher.md",
          folderPath: null,
          reportsToExternalKey: null,
          instructionsMarkdown: "# Researcher\n",
          desiredSkillKeys: ["research"],
          adapterDefaults: { model: "openai/gpt-5.4" },
          fingerprint: "fp-agent-new",
        }],
      },
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.skillUpserts).toEqual([
      expect.objectContaining({ operation: "update", paperclipSkillId: "skill-1" }),
    ]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({
        operation: "update",
        paperclipAgentId: "agent-1",
        desiredSkillKeys: ["research"],
        payload: expect.objectContaining({
          adapterType: "opencode_project_local",
          adapterConfig: expect.objectContaining({
            model: "openai/gpt-5.4",
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
      importedAt,
      existingState: makeState(),
      existingSkills: [],
      existingAgents: [],
      discovery: {
        warnings: [{
          code: "ambiguous_repo_layout",
          message: "Mixed layouts are blocked.",
          repoRelPath: ".opencode/agents",
          entityType: "workspace",
          entityKey: null,
        }],
        skills: [],
        agents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          folderPath: null,
          reportsToExternalKey: null,
          instructionsMarkdown: "# Researcher\n",
          desiredSkillKeys: ["missing-skill"],
          adapterDefaults: {},
          fingerprint: "fp-agent",
        }],
      },
    });

    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "ambiguous_repo_layout" }),
    ]);
    expect(plan.warnings).toEqual([
      "Agent 'Researcher' references unknown repo skill keys: missing-skill.",
    ]);
    expect(plan.agentUpserts[0]?.desiredSkillKeys).toEqual([]);
  });
});

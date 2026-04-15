import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildImportPlan } from "./import-plan.js";
import { discoverOpencodeProjectFiles } from "./discovery.js";
import { opencodeProjectSyncStateSchema } from "./sync-state.js";

const tempDirs: string[] = [];

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
});

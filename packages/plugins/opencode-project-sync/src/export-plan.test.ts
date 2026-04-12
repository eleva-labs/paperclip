import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExportPlan,
  buildRoundTripAgentMarkdown,
  parseAgentSourceDocument,
  validateExportRepoRelPath,
} from "./export-plan.js";
import type { OpencodeProjectSyncState } from "./sync-state.js";

const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";

function makeState(): OpencodeProjectSyncState {
  return {
    projectId,
    workspaceId,
    bootstrapCompletedAt: null,
    canonicalRepoRoot: "/repos/canonical",
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
    selectedAgents: [{
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent",
      selectedAt: "2026-04-11T12:00:00.000Z",
    }],
    importedAgents: [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent",
      canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
      externalAgentName: "Researcher",
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }],
    warnings: [],
    conflicts: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateExportRepoRelPath", () => {
  it("rejects non-canonical, root, skill, and nested export paths", () => {
    expect(validateExportRepoRelPath("agent", "../escape.md")).toEqual({
      ok: false,
      message: "Export target '../escape.md' is not a canonical relative path inside the repo root.",
    });
    expect(validateExportRepoRelPath("agent", "AGENTS.md")).toEqual({
      ok: false,
      message: "Export target 'AGENTS.md' is outside the MVP agent export roots.",
    });
    expect(validateExportRepoRelPath("agent", ".opencode/skills/demo/SKILL.md")).toEqual({
      ok: false,
      message: "Export target '.opencode/skills/demo/SKILL.md' is outside the MVP agent export roots.",
    });
    expect(validateExportRepoRelPath("agent", ".opencode/agents/team/researcher.md")).toEqual({
      ok: false,
      message: "Export target '.opencode/agents/team/researcher.md' is outside the MVP agent export roots.",
    });
  });
});

describe("agent document round-trip", () => {
  it("preserves frontmatter bytes and replaces only body content", () => {
    const parsed = parseAgentSourceDocument("---\nname: Researcher\nmode: subagent\n# keep\n---\n# Old\n")!;

    expect(buildRoundTripAgentMarkdown(parsed, "# New body\n")).toBe(
      "---\nname: Researcher\nmode: subagent\n# keep\n---\n# New body\n",
    );
  });

  it("refuses malformed frontmatter shape", () => {
    expect(parseAgentSourceDocument("---\nname: broken\n# no closing fence\n")).toBeNull();
  });
});

describe("buildExportPlan", () => {
  it("blocks export when canonical repo drift invalidates the last import fingerprint", () => {
    const plan = buildExportPlan({
      state: makeState(),
      repoRoot: "/repos/canonical",
      currentRepoFingerprint: "scan-2",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [],
    });

    expect(plan.blocked).toBe(true);
    expect(plan.files).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift" }),
    ]);
  });

  it("exports only selected sync-managed top-level agents and preserves frontmatter", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((filePath: fs.PathLike) => (
      String(filePath) === "/repos/canonical/.opencode/agents/researcher.md"
    ));
    vi.spyOn(fs, "statSync").mockImplementation((filePath: fs.PathLike) => ({
      isFile: () => String(filePath) === "/repos/canonical/.opencode/agents/researcher.md",
    } as fs.Stats));
    vi.spyOn(fs, "readFileSync").mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      if (String(filePath) === "/repos/canonical/.opencode/agents/researcher.md") {
        return "---\nname: Researcher\nmode: subagent\n---\n# Original\n";
      }
      throw new Error(`Unexpected read: ${String(filePath)}`);
    });

    const plan = buildExportPlan({
      state: makeState(),
      repoRoot: "/repos/canonical",
      currentRepoFingerprint: "scan-1",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [
        {
          id: "agent-1",
          name: "Researcher",
          title: "Lead researcher",
          reportsTo: null,
          adapterConfig: { promptTemplate: "# Updated\n" },
          metadata: {
            syncManaged: true,
            sourceSystem: "opencode_project_repo",
            syncPolicyMode: "top_level_agents_only",
            sourceOfTruth: "repo_first",
            projectId,
            workspaceId,
            repoRoot: "/repos/canonical",
            repoRelPath: ".opencode/agents/researcher.md",
            canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
            externalAgentKey: "researcher",
            externalAgentName: "Researcher",
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            lastImportedFingerprint: "fp-agent",
            lastImportedAt: null,
            lastExportedFingerprint: null,
            lastExportedAt: null,
          },
        },
        {
          id: "agent-2",
          name: "Writer",
          title: null,
          reportsTo: null,
          adapterConfig: { promptTemplate: "# Writer\n" },
          metadata: {
            syncManaged: true,
            sourceSystem: "opencode_project_repo",
            syncPolicyMode: "top_level_agents_only",
            sourceOfTruth: "repo_first",
            projectId,
            workspaceId,
            repoRoot: "/repos/canonical",
            repoRelPath: ".opencode/agents/writer.md",
            canonicalLocator: "/repos/canonical::.opencode/agents/writer.md",
            externalAgentKey: "writer",
            externalAgentName: "Writer",
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            lastImportedFingerprint: "fp-writer",
            lastImportedAt: null,
            lastExportedFingerprint: null,
            lastExportedAt: null,
          },
        },
      ],
    });

    expect(plan.blocked).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toEqual(expect.objectContaining({
      repoRelPath: ".opencode/agents/researcher.md",
      nextContent: "---\nname: Researcher\nmode: subagent\n---\n# Updated\n",
    }));
  });

  it("blocks export when stable mapping is missing or current file shape is unsafe", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockImplementation(() => ({ isFile: () => true } as fs.Stats));
    vi.spyOn(fs, "readFileSync").mockReturnValue("---\nname: broken\n# missing close\n" as any);

    const state = makeState();
    state.importedAgents[0] = {
      ...state.importedAgents[0],
      repoRelPath: ".opencode/agents/researcher.md",
    };

    const plan = buildExportPlan({
      state,
      repoRoot: "/repos/canonical",
      currentRepoFingerprint: "scan-1",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterConfig: { promptTemplate: "# Updated\n" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot: "/repos/canonical",
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
          externalAgentKey: "different-key",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-agent",
          lastImportedAt: null,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
    });

    expect(plan.blocked).toBe(true);
    expect(plan.conflicts[0]?.message).toMatch(/stable repo mapping/i);
  });

  it("blocks export when the source file cannot be round-tripped safely", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "statSync").mockImplementation(() => ({ isFile: () => true } as fs.Stats));
    vi.spyOn(fs, "readFileSync").mockReturnValue("---\nname: broken\n# missing close\n" as any);

    const plan = buildExportPlan({
      state: makeState(),
      repoRoot: "/repos/canonical",
      currentRepoFingerprint: "scan-1",
      forceIfRepoUnchangedCheckFails: false,
      exportAgents: true,
      agents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterConfig: { promptTemplate: "# Updated\n" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot: "/repos/canonical",
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-agent",
          lastImportedAt: null,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
    });

    expect(plan.blocked).toBe(true);
    expect(plan.conflicts[0]?.message).toMatch(/not parseable as optional frontmatter plus markdown body/i);
  });
});

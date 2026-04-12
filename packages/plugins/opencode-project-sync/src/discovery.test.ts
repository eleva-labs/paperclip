import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverOpencodeProjectFiles } from "./discovery.js";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-project-discovery-"));
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

describe("discoverOpencodeProjectFiles", () => {
  it("returns top-level eligible agents with selectionDefault false", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/researcher.md", "---\nname: Researcher\n---\n# Researcher\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.eligibleAgents).toEqual([
      expect.objectContaining({
        externalAgentKey: "researcher",
        repoRelPath: ".opencode/agents/researcher.md",
        selectionDefault: false,
      }),
    ]);
    expect(result.ineligibleNestedAgents).toEqual([]);
    expect(result.ignoredArtifacts).toEqual([]);
  });

  it("excludes nested agents and keeps them in context output only", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/engineering/systems-architect.md", "---\nname: Systems Architect\n---\n# Systems Architect\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.eligibleAgents).toEqual([]);
    expect(result.ineligibleNestedAgents).toEqual([
      expect.objectContaining({
        externalAgentKey: "engineering-systems-architect",
        repoRelPath: ".opencode/agents/engineering/systems-architect.md",
      }),
    ]);
  });

  it("ignores root AGENTS and skill artifacts for import planning while surfacing them", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, "AGENTS.md", "# Repository Guide\n");
    writeFile(repoRoot, ".opencode/skills/research/SKILL.md", "# Research\n");
    writeFile(repoRoot, ".opencode/skills/research/notes.md", "notes\n");
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Researcher\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.eligibleAgents).toHaveLength(1);
    expect(result.ignoredArtifacts).toEqual(expect.arrayContaining([
      { kind: "root_agents_md", repoRelPath: "AGENTS.md" },
      { kind: "skill", repoRelPath: ".opencode/skills/research/SKILL.md" },
      { kind: "skill", repoRelPath: ".opencode/skills/research/notes.md" },
    ]));
  });

  it("emits identity collision warnings for duplicate top-level agent keys", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# One\n");
    writeFile(repoRoot, ".opencode/agents/researcher!.md", "# Two\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "identity_collision",
        entityKey: "researcher",
      }),
    ]));
  });

  it("uses folder depth as source of truth and emits advisory warnings for contradictory mode", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/orchestrator.md", "---\nmode: subagent\n---\n# Orchestrator\n");
    writeFile(repoRoot, ".opencode/agents/team/qa.md", "---\nmode: primary\n---\n# QA\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.eligibleAgents).toEqual([
      expect.objectContaining({ externalAgentKey: "orchestrator", advisoryMode: "subagent" }),
    ]);
    expect(result.ineligibleNestedAgents).toEqual([
      expect.objectContaining({ externalAgentKey: "team-qa" }),
    ]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "contradictory_advisory_mode", repoRelPath: ".opencode/agents/orchestrator.md" }),
      expect.objectContaining({ code: "contradictory_advisory_mode", repoRelPath: ".opencode/agents/team/qa.md" }),
    ]));
  });
});

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
  it("discovers supported MVP roots and derives stable agent/skill identities", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, "opencode.json", JSON.stringify({ paperclip: { model: "openai/gpt-5.4" } }, null, 2));
    writeFile(repoRoot, "AGENTS.md", "# Repository Guide\n");
    writeFile(
      repoRoot,
      ".opencode/skills/research/SKILL.md",
      "---\nname: Research Skill\n---\n# Research\n",
    );
    writeFile(
      repoRoot,
      ".opencode/agents/researcher.md",
      "---\nname: Researcher\ndesiredSkills:\n  - research\n---\n# Researcher\n",
    );

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.warnings).toEqual([]);
    expect(result.supportedFiles).toEqual(expect.arrayContaining([
      "AGENTS.md",
      "opencode.json",
      ".opencode/agents/researcher.md",
      ".opencode/skills/research/SKILL.md",
    ]));
    expect(result.agents).toEqual([
      expect.objectContaining({
        externalAgentKey: "researcher",
        desiredSkillKeys: ["research"],
        adapterDefaults: { model: "openai/gpt-5.4" },
      }),
    ]);
    expect(result.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalSkillKey: "research" }),
      expect.objectContaining({ externalSkillKey: "repo-root-agents" }),
    ]));
    expect(result.lastScanFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("blocks ambiguous mixed agent layouts and legacy skill roots with actionable warnings", () => {
    const repoRoot = makeTempRepo();
    writeFile(repoRoot, ".opencode/agents/researcher.md", "# Standard\n");
    writeFile(repoRoot, ".opencode/agents/agents/researcher.md", "# Compat\n");
    writeFile(repoRoot, ".opencode/agents/skills/legacy/SKILL.md", "# Legacy\n");

    const result = discoverOpencodeProjectFiles({ repoRoot });

    expect(result.agents).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ambiguous_repo_layout", repoRelPath: ".opencode/agents" }),
      expect.objectContaining({ code: "ambiguous_repo_layout", repoRelPath: ".opencode/agents/skills" }),
    ]));
  });
});

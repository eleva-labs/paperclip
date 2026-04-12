import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeContainedExportFile, writeGuardedAgentExportFile } from "../src/export-write-guard.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-project-sync-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeContainedExportFile", () => {
  it("creates missing in-repo agent directories before writing", () => {
    const repoRoot = makeTempDir();

    writeContainedExportFile(repoRoot, ".opencode/agents/demo.md", "# Demo\n");

    expect(fs.readFileSync(path.join(repoRoot, ".opencode/agents/demo.md"), "utf8")).toBe("# Demo\n");
  });

  it("rejects symlinked parent paths that escape the repo", () => {
    const repoRoot = makeTempDir();
    const outsideRoot = makeTempDir();

    fs.mkdirSync(path.join(repoRoot, ".opencode"));
    fs.symlinkSync(outsideRoot, path.join(repoRoot, ".opencode", "agents"), "dir");

    expect(() => writeContainedExportFile(repoRoot, ".opencode/agents/demo.md", "# Demo\n")).toThrow(
      /symlinked path '.opencode\/agents'/,
    );
    expect(fs.existsSync(path.join(outsideRoot, "demo.md"))).toBe(false);
  });
});

describe("writeGuardedAgentExportFile", () => {
  it("writes planned content when the on-disk file still matches the planned source", () => {
    const repoRoot = makeTempDir();
    const repoRelPath = ".opencode/agents/researcher.md";
    const source = "---\nname: Researcher\nmode: subagent\n---\n# Original\n";
    const filePath = path.join(repoRoot, repoRelPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, "utf8");

    writeGuardedAgentExportFile(repoRoot, repoRelPath, source, "---\nname: Researcher\nmode: subagent\n---\n# Updated\n");

    expect(fs.readFileSync(filePath, "utf8")).toBe("---\nname: Researcher\nmode: subagent\n---\n# Updated\n");
  });

  it("refuses repo drift when the file changed after planning", () => {
    const repoRoot = makeTempDir();
    const repoRelPath = ".opencode/agents/researcher.md";
    const source = "# Original\n";
    const filePath = path.join(repoRoot, repoRelPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "# Changed in repo\n", "utf8");

    expect(() => writeGuardedAgentExportFile(repoRoot, repoRelPath, source, "# Updated\n")).toThrow(
      /changed on disk since planning/,
    );
  });

  it("refuses unsafe round-trips when the on-disk source is unparseable", () => {
    const repoRoot = makeTempDir();
    const repoRelPath = ".opencode/agents/researcher.md";
    const source = "---\nname: broken\n# missing close\n";
    const filePath = path.join(repoRoot, repoRelPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source, "utf8");

    expect(() => writeGuardedAgentExportFile(repoRoot, repoRelPath, source, "# Updated\n")).toThrow(
      /not parseable as optional frontmatter plus markdown body/,
    );
  });
});

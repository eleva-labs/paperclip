import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeContainedExportFile } from "../src/export-write-guard.js";

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
  it("creates missing in-repo directories before writing", () => {
    const repoRoot = makeTempDir();

    writeContainedExportFile(repoRoot, ".opencode/skills/demo/SKILL.md", "# Demo\n");

    expect(fs.readFileSync(path.join(repoRoot, ".opencode/skills/demo/SKILL.md"), "utf8")).toBe("# Demo\n");
  });

  it("rejects symlinked parent paths that escape the repo", () => {
    const repoRoot = makeTempDir();
    const outsideRoot = makeTempDir();

    fs.mkdirSync(path.join(repoRoot, ".opencode"));
    fs.symlinkSync(outsideRoot, path.join(repoRoot, ".opencode", "skills"), "dir");

    expect(() => writeContainedExportFile(repoRoot, ".opencode/skills/demo/SKILL.md", "# Demo\n")).toThrow(
      /symlinked path '.opencode\/skills'/,
    );
    expect(fs.existsSync(path.join(outsideRoot, "demo", "SKILL.md"))).toBe(false);
  });
});

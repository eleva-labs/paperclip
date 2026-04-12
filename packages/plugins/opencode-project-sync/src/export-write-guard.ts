import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgentSourceDocument } from "./export-plan.js";

function realpath(filePath: string): string {
  return typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(filePath)
    : fs.realpathSync(filePath);
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSafeExistingPath(canonicalRepoRoot: string, repoRelPath: string, fullPath: string): void {
  const relativePath = path.relative(canonicalRepoRoot, fullPath) || ".";
  const stat = fs.lstatSync(fullPath);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `Export target '${repoRelPath}' traverses symlinked path '${relativePath}' and cannot be written.`,
    );
  }

  const resolvedPath = realpath(fullPath);
  if (!isPathInsideRoot(canonicalRepoRoot, resolvedPath)) {
    throw new Error(
      `Export target '${repoRelPath}' resolves outside the canonical repo root through '${relativePath}' and cannot be written.`,
    );
  }
}

function ensureSafeParentPath(canonicalRepoRoot: string, repoRelPath: string): string {
  const targetPath = path.resolve(canonicalRepoRoot, repoRelPath);
  const relativeToRepoRoot = path.relative(canonicalRepoRoot, targetPath);
  if (relativeToRepoRoot.startsWith("..") || path.isAbsolute(relativeToRepoRoot)) {
    throw new Error(`Export target '${repoRelPath}' resolves outside the canonical repo root and cannot be written.`);
  }

  const segments = repoRelPath.split("/").filter(Boolean);
  let currentPath = canonicalRepoRoot;

  for (let index = 0; index < segments.length - 1; index += 1) {
    currentPath = path.join(currentPath, segments[index] as string);
    if (fs.existsSync(currentPath)) {
      assertSafeExistingPath(canonicalRepoRoot, repoRelPath, currentPath);
      if (!fs.statSync(currentPath).isDirectory()) {
        throw new Error(
          `Export target '${repoRelPath}' cannot be written because '${path.relative(canonicalRepoRoot, currentPath)}' is not a directory.`,
        );
      }
      continue;
    }

    fs.mkdirSync(currentPath);
  }

  return targetPath;
}

export function writeContainedExportFile(repoRoot: string, repoRelPath: string, content: string): void {
  const canonicalRepoRoot = realpath(repoRoot);
  const targetPath = ensureSafeParentPath(canonicalRepoRoot, repoRelPath);

  if (fs.existsSync(targetPath)) {
    assertSafeExistingPath(canonicalRepoRoot, repoRelPath, targetPath);
    if (fs.statSync(targetPath).isDirectory()) {
      throw new Error(`Export target '${repoRelPath}' is an existing directory and cannot be overwritten as a file.`);
    }
  }

  const handle = fs.openSync(
    targetPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o666,
  );

  try {
    fs.writeFileSync(handle, content, "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

export function writeGuardedAgentExportFile(
  repoRoot: string,
  repoRelPath: string,
  expectedFingerprint: string,
  nextContent: string,
): void {
  const canonicalRepoRoot = realpath(repoRoot);
  const targetPath = ensureSafeParentPath(canonicalRepoRoot, repoRelPath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Export target '${repoRelPath}' no longer exists in the repo and cannot be exported safely.`);
  }

  assertSafeExistingPath(canonicalRepoRoot, repoRelPath, targetPath);
  if (!fs.statSync(targetPath).isFile()) {
    throw new Error(`Export target '${repoRelPath}' is not a file and cannot be exported safely.`);
  }

  const currentContent = fs.readFileSync(targetPath, "utf8");
  const parsed = parseAgentSourceDocument(currentContent);
  if (!parsed) {
    throw new Error(
      `Export target '${repoRelPath}' is no longer parseable as optional frontmatter plus markdown body and cannot be exported safely.`,
    );
  }

  if (expectedFingerprint !== currentContent) {
    throw new Error(
      `Export target '${repoRelPath}' changed on disk since planning and cannot be exported safely without re-importing.`,
    );
  }

  writeContainedExportFile(canonicalRepoRoot, repoRelPath, nextContent);
}

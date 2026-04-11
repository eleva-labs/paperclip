import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { logger } from "../middleware/logger.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

type PackageJson = {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
};

type StageResult = {
  packageName: string;
  packagePath: string;
  version?: string;
};

type StageContext = {
  fakeRepoRoot: string;
  workspacePackages: Map<string, string>;
  cache: Map<string, StageResult>;
  topLevelSourceDir: string;
};

const WORKSPACE_PROTOCOL = "workspace:";
const WORKSPACE_DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function applyPublishConfig(pkg: PackageJson): PackageJson {
  const publishConfig = pkg.publishConfig;
  if (!publishConfig || typeof publishConfig !== "object") {
    return pkg;
  }

  const merged: PackageJson = { ...pkg };
  for (const [key, value] of Object.entries(publishConfig)) {
    if (key === "access") continue;
    merged[key] = value;
  }
  return merged;
}

async function readPackageJson(packageDir: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf-8")) as PackageJson;
}

async function listWorkspacePackageDirs(): Promise<string[]> {
  const dirs = [
    "packages",
    path.join("packages", "adapters"),
    path.join("packages", "plugins"),
    "server",
    "ui",
    "cli",
  ];

  const results = new Set<string>();

  for (const relativeDir of dirs) {
    const absDir = path.join(REPO_ROOT, relativeDir);
    if (!existsSync(absDir)) continue;

    if (relativeDir === "server" || relativeDir === "ui" || relativeDir === "cli") {
      if (existsSync(path.join(absDir, "package.json"))) {
        results.add(absDir);
      }
      continue;
    }

    for (const entry of await readDirSafe(absDir)) {
      const childDir = path.join(absDir, entry);
      if (existsSync(path.join(childDir, "package.json"))) {
        results.add(childDir);
      }
    }
  }

  return [...results];
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function buildWorkspacePackageMap(): Promise<Map<string, string>> {
  const dirs = await listWorkspacePackageDirs();
  const map = new Map<string, string>();

  for (const dir of dirs) {
    try {
      const pkg = await readPackageJson(dir);
      if (typeof pkg.name === "string" && pkg.name.length > 0) {
        map.set(pkg.name, dir);
      }
    } catch {
      // Ignore non-package directories.
    }
  }

  return map;
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function installDependencies(stageDir: string): Promise<void> {
  await execFileAsync("npm", ["install"], {
    cwd: stageDir,
    timeout: 240_000,
  });
}

async function buildPackageIfPresent(stageDir: string, pkg: PackageJson): Promise<void> {
  if (!pkg.scripts || typeof pkg.scripts.build !== "string") {
    return;
  }

  await execFileAsync("npm", ["run", "build"], {
    cwd: stageDir,
    timeout: 240_000,
  });
}

function packageHasBuildArtifacts(stageDir: string, pkg: PackageJson): boolean {
  const candidatePaths = new Set<string>();
  const requiredPaths = new Set<string>();

  if (typeof pkg.main === "string") {
    candidatePaths.add(pkg.main);
  }

  if (pkg.exports && typeof pkg.exports === "object") {
    for (const value of Object.values(pkg.exports)) {
      if (typeof value === "string") {
        candidatePaths.add(value);
        continue;
      }
      if (value && typeof value === "object") {
        const maybeImport = (value as Record<string, unknown>).import;
        const maybeDefault = (value as Record<string, unknown>).default;
        if (typeof maybeImport === "string") candidatePaths.add(maybeImport);
        if (typeof maybeDefault === "string") candidatePaths.add(maybeDefault);
      }
    }
  }

  const paperclipPlugin = pkg.paperclipPlugin;
  if (paperclipPlugin && typeof paperclipPlugin === "object") {
    for (const value of Object.values(paperclipPlugin)) {
      if (typeof value === "string") {
        candidatePaths.add(value);
        requiredPaths.add(value);
      }
    }
  }

  const paperclipAdapter = pkg.paperclip;
  if (
    paperclipAdapter
    && typeof paperclipAdapter === "object"
    && typeof (paperclipAdapter as Record<string, unknown>).adapterUiParser === "string"
  ) {
    const uiParserExport = pkg.exports && typeof pkg.exports === "object"
      ? (pkg.exports as Record<string, unknown>)["./ui-parser"]
      : undefined;
    if (typeof uiParserExport === "string") {
      requiredPaths.add(uiParserExport);
    } else if (uiParserExport && typeof uiParserExport === "object") {
      const maybeImport = (uiParserExport as Record<string, unknown>).import;
      const maybeDefault = (uiParserExport as Record<string, unknown>).default;
      if (typeof maybeImport === "string") requiredPaths.add(maybeImport);
      else if (typeof maybeDefault === "string") requiredPaths.add(maybeDefault);
    }
  }

  if (requiredPaths.size > 0) {
    return [...requiredPaths].every((candidate) => existsSync(path.resolve(stageDir, candidate)));
  }

  return [...candidatePaths].some((candidate) => existsSync(path.resolve(stageDir, candidate)));
}

async function stagePackageRecursive(
  sourceDir: string,
  context: StageContext,
): Promise<StageResult> {
  const resolvedSourceDir = path.resolve(sourceDir);
  const cached = context.cache.get(resolvedSourceDir);
  if (cached) {
    return cached;
  }

  const sourcePkg = await readPackageJson(resolvedSourceDir);
  const isTopLevelPackage = resolvedSourceDir === context.topLevelSourceDir;
  const packageName = typeof sourcePkg.name === "string" && sourcePkg.name.length > 0
    ? sourcePkg.name
    : path.basename(resolvedSourceDir);

  const relativeSourcePath = path.relative(REPO_ROOT, resolvedSourceDir);
  if (relativeSourcePath.startsWith("..") || path.isAbsolute(relativeSourcePath)) {
    throw new Error(
      `Cannot stage local package outside repo root: ${resolvedSourceDir}`,
    );
  }

  const stageDir = path.join(context.fakeRepoRoot, relativeSourcePath);
  await mkdir(path.dirname(stageDir), { recursive: true });

  await cp(resolvedSourceDir, stageDir, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const name = path.basename(entry);
      return name !== "node_modules" && name !== ".turbo" && name !== ".git";
    },
  });

  let stagedPkg = applyPublishConfig(await readPackageJson(stageDir));

  for (const field of WORKSPACE_DEP_FIELDS) {
    const deps = stagedPkg[field];
    if (!deps) continue;

    const rewritten = { ...deps };
    let changed = false;

    for (const [depName, depVersion] of Object.entries(deps)) {
      if (!depVersion.startsWith(WORKSPACE_PROTOCOL)) {
        continue;
      }

      const workspaceDir = context.workspacePackages.get(depName);
      if (!workspaceDir) {
        throw new Error(
          `Cannot stage local package ${packageName}: workspace dependency ${depName} was not found in this repo.`,
        );
      }

      const stagedDep = await stagePackageRecursive(workspaceDir, context);
      rewritten[depName] = `file:${stagedDep.packagePath}`;
      changed = true;
    }

    if (changed) {
      stagedPkg[field] = rewritten;
    }
  }

  await writeFile(path.join(stageDir, "package.json"), `${JSON.stringify(stagedPkg, null, 2)}\n`, "utf-8");

  const result: StageResult = {
    packageName,
    packagePath: stageDir,
    version: typeof stagedPkg.version === "string" ? stagedPkg.version : undefined,
  };
  context.cache.set(resolvedSourceDir, result);

  try {
    await installDependencies(stageDir);
    if (isTopLevelPackage && !packageHasBuildArtifacts(stageDir, stagedPkg)) {
      await buildPackageIfPresent(stageDir, stagedPkg);
    }
  } catch (error) {
      await rm(stageDir, { recursive: true, force: true });
    context.cache.delete(resolvedSourceDir);
    throw error;
  }

  logger.info(
    { sourceDir: resolvedSourceDir, stageDir, packageName },
    "Staged local package with package-managed dependency closure",
  );

  return result;
}

export async function stageLocalPackageInstall(
  localPath: string,
  targetRoot: string,
): Promise<StageResult> {
  const resolvedLocalPath = path.resolve(localPath);
  if (!existsSync(resolvedLocalPath)) {
    throw new Error(`Local package path does not exist: ${resolvedLocalPath}`);
  }

  const workspacePackages = await buildWorkspacePackageMap();
  const cache = new Map<string, StageResult>();

  const stagingRoot = path.join(
    targetRoot,
    "local-path-staging",
    `${Date.now()}-${sanitizeForPath(path.basename(resolvedLocalPath))}`,
  );
  const fakeRepoRoot = path.join(stagingRoot, "repo");
  await mkdir(fakeRepoRoot, { recursive: true });

  for (const rootFile of ["tsconfig.json", "tsconfig.base.json", "package.json"]) {
    const sourceFile = path.join(REPO_ROOT, rootFile);
    if (existsSync(sourceFile)) {
      await mkdir(path.dirname(path.join(fakeRepoRoot, rootFile)), { recursive: true });
      await cp(sourceFile, path.join(fakeRepoRoot, rootFile), { force: true });
    }
  }

  const scriptsDir = path.join(REPO_ROOT, "scripts");
  if (existsSync(scriptsDir)) {
    await cp(scriptsDir, path.join(fakeRepoRoot, "scripts"), {
      recursive: true,
      force: true,
      filter: (entry) => path.basename(entry) !== "node_modules",
    });
  }

  const rootTypescriptDir = path.join(REPO_ROOT, "node_modules", "typescript");
  if (existsSync(rootTypescriptDir)) {
    await mkdir(path.join(fakeRepoRoot, "node_modules"), { recursive: true });
    await cp(rootTypescriptDir, path.join(fakeRepoRoot, "node_modules", "typescript"), {
      recursive: true,
      force: true,
    });
  }

  return stagePackageRecursive(resolvedLocalPath, {
    fakeRepoRoot,
    workspacePackages,
    cache,
    topLevelSourceDir: resolvedLocalPath,
  });
}

export function getDefaultTempRoot(): string {
  return path.join(os.tmpdir(), "paperclip-local-package-staging");
}

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type DiscoveredRepoAgent = {
  externalAgentKey: string;
  displayName: string;
  role: string | null;
  repoRelPath: string;
  instructionsMarkdown: string;
  advisoryMode: "primary" | "subagent" | null;
  selectionDefault: boolean;
  fingerprint: string;
};

export type DiscoveredNestedAgent = {
  externalAgentKey: string;
  displayName: string;
  repoRelPath: string;
};

export type IgnoredArtifact = {
  kind: "skill" | "root_agents_md" | "other";
  repoRelPath: string;
};

export type DiscoveryWarningCode = "invalid_repo_file" | "identity_collision" | "contradictory_advisory_mode";

export type DiscoveryWarning = {
  code: DiscoveryWarningCode;
  message: string;
  repoRelPath: string | null;
  entityType: "agent" | "workspace" | null;
  entityKey: string | null;
};

export type DiscoveredOpencodeProjectFiles = {
  eligibleAgents: DiscoveredRepoAgent[];
  ineligibleNestedAgents: DiscoveredNestedAgent[];
  ignoredArtifacts: IgnoredArtifact[];
  warnings: DiscoveryWarning[];
  lastScanFingerprint: string;
  supportedFiles: string[];
  rootAgentsMarkdown: string | null;
  opencodeConfig: Record<string, unknown> | null;
};

type ParsedFrontmatter = {
  attributes: Record<string, unknown>;
  body: string;
};

const AGENT_ROOT = ".opencode/agents";
const SKILL_ROOT = ".opencode/skills";
const ROOT_AGENTS_FILE = "AGENTS.md";
const ROOT_OPENCODE_FILE = "opencode.json";

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function isDirectory(filePath: string): boolean {
  return exists(filePath) && fs.statSync(filePath).isDirectory();
}

function isFile(filePath: string): boolean {
  return exists(filePath) && fs.statSync(filePath).isFile();
}

function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9/._-]+/g, "-")
    .replace(/[/.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

function titleCase(value: string): string {
  return value
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
  if (!markdown.startsWith("---\n")) {
    return { attributes: {}, body: markdown };
  }
  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { attributes: {}, body: markdown };
  }

  const header = markdown.slice(4, endIndex);
  const body = markdown.slice(endIndex + 5);
  const attributes: Record<string, unknown> = {};
  const lines = header.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    const trimmedValue = rawValue.trim();

    if (trimmedValue === "" || trimmedValue === "|" || trimmedValue === ">") {
      const block: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex] ?? "";
        if (!nextLine.startsWith("  ")) break;
        block.push(nextLine.slice(2));
        nextIndex += 1;
      }
      index = nextIndex - 1;
      attributes[key] = block.join("\n").trim();
      continue;
    }

    if (trimmedValue === "[]") {
      attributes[key] = [];
      continue;
    }

    if (trimmedValue.startsWith("[") && trimmedValue.endsWith("]")) {
      attributes[key] = trimmedValue.slice(1, -1).split(",").map((entry) => parseScalar(entry)).filter((entry) => String(entry).trim().length > 0);
      continue;
    }

    attributes[key] = parseScalar(trimmedValue);
  }

  return { attributes, body };
}

function extractHeading(markdownBody: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdownBody);
  return match?.[1]?.trim() || null;
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  if (!isDirectory(root)) return out;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const names = fs.readdirSync(current).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const fullPath = path.join(current, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      out.push(fullPath);
    }
  }
  return out.sort((left, right) => left.localeCompare(right));
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!isFile(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function deriveAgentExternalKey(repoRelPath: string): string {
  const normalized = normalizeSlashes(repoRelPath);
  if (normalized.startsWith(`${AGENT_ROOT}/`)) {
    return slugify(normalized.slice(AGENT_ROOT.length + 1));
  }
  return slugify(normalized);
}

function getAgentDepth(repoRelPath: string): number {
  const normalized = normalizeSlashes(repoRelPath);
  if (!normalized.startsWith(`${AGENT_ROOT}/`)) return Number.POSITIVE_INFINITY;
  const relative = normalized.slice(AGENT_ROOT.length + 1);
  return relative.split("/").length;
}

function getAdvisoryMode(attributes: Record<string, unknown>): "primary" | "subagent" | null {
  const raw = attributes.mode;
  if (raw === "primary" || raw === "subagent") return raw;
  return null;
}

function createContradictoryModeWarning(repoRelPath: string, externalAgentKey: string, advisoryMode: "primary" | "subagent"): DiscoveryWarning | null {
  const depth = getAgentDepth(repoRelPath);
  if (depth === 1 && advisoryMode === "subagent") {
    return {
      code: "contradictory_advisory_mode",
      message: `Top-level agent '${repoRelPath}' declares advisory mode 'subagent'; folder depth remains the source of truth and the file stays eligible.`,
      repoRelPath,
      entityType: "agent",
      entityKey: externalAgentKey,
    };
  }
  if (depth > 1 && advisoryMode === "primary") {
    return {
      code: "contradictory_advisory_mode",
      message: `Nested agent '${repoRelPath}' declares advisory mode 'primary'; folder depth remains the source of truth and the file stays ineligible.`,
      repoRelPath,
      entityType: "agent",
      entityKey: externalAgentKey,
    };
  }
  return null;
}

export function discoverOpencodeProjectFiles(input: { repoRoot: string }): DiscoveredOpencodeProjectFiles {
  const repoRoot = path.resolve(input.repoRoot);
  const warnings: DiscoveryWarning[] = [];
  const supportedFiles = new Set<string>();
  const ignoredArtifacts = new Map<string, IgnoredArtifact>();
  const eligibleAgentsByKey = new Map<string, DiscoveredRepoAgent>();
  const nestedAgents: DiscoveredNestedAgent[] = [];
  const opencodeConfigPath = path.join(repoRoot, ROOT_OPENCODE_FILE);
  const opencodeConfig = readJsonObject(opencodeConfigPath);

  if (isFile(opencodeConfigPath)) {
    supportedFiles.add(ROOT_OPENCODE_FILE);
    if (!opencodeConfig) {
      warnings.push({
        code: "invalid_repo_file",
        message: "Repo-root opencode.json exists but could not be parsed as a JSON object.",
        repoRelPath: ROOT_OPENCODE_FILE,
        entityType: "workspace",
        entityKey: null,
      });
    }
  }

  const rootAgentsPath = path.join(repoRoot, ROOT_AGENTS_FILE);
  let rootAgentsMarkdown: string | null = null;
  if (isFile(rootAgentsPath)) {
    rootAgentsMarkdown = fs.readFileSync(rootAgentsPath, "utf8");
    supportedFiles.add(ROOT_AGENTS_FILE);
    ignoredArtifacts.set(ROOT_AGENTS_FILE, {
      kind: "root_agents_md",
      repoRelPath: ROOT_AGENTS_FILE,
    });
  }

  const skillRootPath = path.join(repoRoot, SKILL_ROOT);
  for (const filePath of walkFiles(skillRootPath)) {
    const repoRelPath = normalizeSlashes(path.relative(repoRoot, filePath));
    supportedFiles.add(repoRelPath);
    ignoredArtifacts.set(repoRelPath, {
      kind: "skill",
      repoRelPath,
    });
  }

  const allAgentFiles = walkFiles(path.join(repoRoot, AGENT_ROOT));
  for (const filePath of allAgentFiles) {
    const repoRelPath = normalizeSlashes(path.relative(repoRoot, filePath));
    supportedFiles.add(repoRelPath);
    if (!repoRelPath.toLowerCase().endsWith(".md")) {
      ignoredArtifacts.set(repoRelPath, {
        kind: "other",
        repoRelPath,
      });
      continue;
    }

    const instructionsMarkdown = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontmatter(instructionsMarkdown);
    const externalAgentKey = deriveAgentExternalKey(repoRelPath);
    const displayName = String(parsed.attributes.name ?? extractHeading(parsed.body) ?? titleCase(path.basename(externalAgentKey))).trim();
    const role = typeof parsed.attributes.role === "string" ? parsed.attributes.role.trim() : null;
    const advisoryMode = getAdvisoryMode(parsed.attributes);
    const contradictoryModeWarning = advisoryMode ? createContradictoryModeWarning(repoRelPath, externalAgentKey, advisoryMode) : null;
    if (contradictoryModeWarning) warnings.push(contradictoryModeWarning);

    const depth = getAgentDepth(repoRelPath);
    if (depth === 1) {
      const fingerprint = sha256(repoRelPath, instructionsMarkdown);
      const existing = eligibleAgentsByKey.get(externalAgentKey);
      if (existing && existing.repoRelPath !== repoRelPath) {
        warnings.push({
          code: "identity_collision",
          message: `Agent identity '${externalAgentKey}' is defined by multiple eligible top-level files (${existing.repoRelPath}, ${repoRelPath}).`,
          repoRelPath,
          entityType: "agent",
          entityKey: externalAgentKey,
        });
        continue;
      }

      eligibleAgentsByKey.set(externalAgentKey, {
        externalAgentKey,
        displayName,
        role,
        repoRelPath,
        instructionsMarkdown,
        advisoryMode,
        selectionDefault: false,
        fingerprint,
      });
      continue;
    }

    nestedAgents.push({
      externalAgentKey,
      displayName,
      repoRelPath,
    });
  }

  const orderedFiles = [...supportedFiles].sort((left, right) => left.localeCompare(right));
  const lastScanFingerprint = sha256(...orderedFiles.map((file) => `${file}:${isFile(path.join(repoRoot, file)) ? fs.readFileSync(path.join(repoRoot, file), "utf8") : "missing"}`));

  return {
    eligibleAgents: [...eligibleAgentsByKey.values()].sort((left, right) => left.externalAgentKey.localeCompare(right.externalAgentKey)),
    ineligibleNestedAgents: nestedAgents.sort((left, right) => left.repoRelPath.localeCompare(right.repoRelPath)),
    ignoredArtifacts: [...ignoredArtifacts.values()].sort((left, right) => left.repoRelPath.localeCompare(right.repoRelPath)),
    warnings,
    lastScanFingerprint,
    supportedFiles: orderedFiles,
    rootAgentsMarkdown,
    opencodeConfig,
  };
}

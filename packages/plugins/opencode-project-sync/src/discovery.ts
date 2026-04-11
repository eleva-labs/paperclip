import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type DiscoveredRepoAgent = {
  externalAgentKey: string;
  displayName: string;
  role: string | null;
  repoRelPath: string;
  folderPath: string | null;
  reportsToExternalKey: string | null;
  instructionsMarkdown: string;
  desiredSkillKeys: string[];
  adapterDefaults: Record<string, unknown>;
  fingerprint: string;
};

export type DiscoveredRepoSkill = {
  externalSkillKey: string;
  displayName: string;
  repoRelPath: string;
  markdown: string;
  fileInventory: Array<{ path: string; kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other" }>;
  fingerprint: string;
};

export type DiscoveryWarningCode = "ambiguous_repo_layout" | "invalid_repo_file" | "identity_collision";

export type DiscoveryWarning = {
  code: DiscoveryWarningCode;
  message: string;
  repoRelPath: string | null;
  entityType: "agent" | "skill" | "workspace" | null;
  entityKey: string | null;
};

export type DiscoveredOpencodeProjectFiles = {
  agents: DiscoveredRepoAgent[];
  skills: DiscoveredRepoSkill[];
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
const AGENT_COMPAT_ROOT = ".opencode/agents/agents";
const SKILL_ROOT = ".opencode/skills";
const LEGACY_SKILL_ROOT = ".opencode/agents/skills";
const ROOT_AGENTS_FILE = "AGENTS.md";
const ROOT_OPENCODE_FILE = "opencode.json";
const SKILL_REFERENCE_PATTERN = /(?:\.opencode\/(?:agents\/)?skills\/|skill:\/\/)([A-Za-z0-9_./-]+)/g;

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
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
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
      attributes[key] = trimmedValue
        .slice(1, -1)
        .split(",")
        .map((entry) => parseScalar(entry))
        .filter((entry) => String(entry).trim().length > 0);
      continue;
    }

    const list: unknown[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex] ?? "";
      const listMatch = /^\s*[-*]\s+(.*)$/.exec(nextLine);
      if (!listMatch) break;
      list.push(parseScalar(listMatch[1] ?? ""));
      nextIndex += 1;
    }
    if (list.length > 0) {
      index = nextIndex - 1;
      attributes[key] = list;
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

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function classifyInventoryKind(repoRelPath: string): "skill" | "markdown" | "reference" | "script" | "asset" | "other" {
  const lower = repoRelPath.toLowerCase();
  if (lower.endsWith("/skill.md") || lower.endsWith("skill.md")) return "skill";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".sh") || lower.endsWith(".py") || lower.endsWith(".ts") || lower.endsWith(".js")) return "script";
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".svg")) return "asset";
  if (lower.endsWith(".txt") || lower.endsWith(".json") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return "reference";
  return "other";
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

function deriveSkillExternalKey(repoRelPath: string): string {
  const normalized = normalizeSlashes(repoRelPath);
  if (!normalized.startsWith(`${SKILL_ROOT}/`)) {
    return slugify(normalized);
  }
  const relative = normalized.slice(SKILL_ROOT.length + 1);
  if (relative.toLowerCase() === "readme.md") return "skills-readme";
  if (relative.endsWith("/SKILL.md")) {
    return slugify(relative.slice(0, -"/SKILL.md".length));
  }
  return slugify(relative);
}

function deriveAgentExternalKey(repoRelPath: string): string {
  const normalized = normalizeSlashes(repoRelPath);
  if (normalized === ROOT_AGENTS_FILE) return "repo-root-agents";
  if (normalized.startsWith(`${AGENT_COMPAT_ROOT}/`)) {
    return slugify(normalized.slice(AGENT_COMPAT_ROOT.length + 1));
  }
  if (normalized.startsWith(`${AGENT_ROOT}/`)) {
    return slugify(normalized.slice(AGENT_ROOT.length + 1));
  }
  return slugify(normalized);
}

function deriveAgentFolderPath(repoRelPath: string): string | null {
  const normalized = normalizeSlashes(repoRelPath);
  if (normalized === ROOT_AGENTS_FILE) return null;
  const externalKey = deriveAgentExternalKey(repoRelPath);
  const parts = externalKey.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
}

function extractDesiredSkillKeys(frontmatter: Record<string, unknown>, body: string): string[] {
  const values = [
    ...toStringArray(frontmatter.skills),
    ...toStringArray(frontmatter.skill),
    ...toStringArray(frontmatter.desiredSkills),
    ...toStringArray(frontmatter.desired_skills),
  ];

  for (const match of body.matchAll(SKILL_REFERENCE_PATTERN)) {
    const raw = (match[1] ?? "").replace(/\/SKILL\.md$/i, "").replace(/\/$/, "");
    if (raw) values.push(raw);
  }

  return [...new Set(values.map((entry) => slugify(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!isFile(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getAdapterDefaults(opencodeConfig: Record<string, unknown> | null): Record<string, unknown> {
  const defaults = opencodeConfig?.paperclip;
  if (defaults && typeof defaults === "object" && !Array.isArray(defaults)) {
    return { ...(defaults as Record<string, unknown>) };
  }
  return {};
}

export function discoverOpencodeProjectFiles(input: { repoRoot: string }): DiscoveredOpencodeProjectFiles {
  const repoRoot = path.resolve(input.repoRoot);
  const warnings: DiscoveryWarning[] = [];
  const supportedFiles = new Set<string>();
  const agents = new Map<string, DiscoveredRepoAgent>();
  const skills = new Map<string, DiscoveredRepoSkill>();
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
    const parsed = parseFrontmatter(rootAgentsMarkdown);
    const displayName = String(parsed.attributes.name ?? extractHeading(parsed.body) ?? "Repository Instructions").trim();
    const fingerprint = sha256(ROOT_AGENTS_FILE, rootAgentsMarkdown);
    const externalSkillKey = "repo-root-agents";
    skills.set(externalSkillKey, {
      externalSkillKey,
      displayName,
      repoRelPath: ROOT_AGENTS_FILE,
      markdown: rootAgentsMarkdown,
      fileInventory: [{ path: ROOT_AGENTS_FILE, kind: "markdown" }],
      fingerprint,
    });
  }

  const legacySkillRootPath = path.join(repoRoot, LEGACY_SKILL_ROOT);
  const legacySkillFiles = walkFiles(legacySkillRootPath);
  if (legacySkillFiles.length > 0) {
    warnings.push({
      code: "ambiguous_repo_layout",
      message: `Legacy skill files were found under '${LEGACY_SKILL_ROOT}'. Cycle 2.2 only supports '${SKILL_ROOT}/**'; migrate these files before importing.`,
      repoRelPath: LEGACY_SKILL_ROOT,
      entityType: "workspace",
      entityKey: null,
    });
  }

  const skillRootPath = path.join(repoRoot, SKILL_ROOT);
  if (isDirectory(skillRootPath)) {
    for (const filePath of walkFiles(skillRootPath)) {
      const repoRelPath = normalizeSlashes(path.relative(repoRoot, filePath));
      supportedFiles.add(repoRelPath);
      if (!repoRelPath.toLowerCase().endsWith(".md")) continue;
      const lower = repoRelPath.toLowerCase();
      if (lower.endsWith("/readme.md") && !lower.endsWith("/skill.md")) continue;
      if (!lower.endsWith("/skill.md") && path.basename(repoRelPath).toLowerCase() === "readme.md") continue;

      const markdown = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontmatter(markdown);
      const externalSkillKey = deriveSkillExternalKey(repoRelPath);
      const displayName = String(parsed.attributes.name ?? extractHeading(parsed.body) ?? titleCase(externalSkillKey)).trim();
      const inventory = walkFiles(path.dirname(filePath))
        .map((entryPath) => {
          const entryRelPath = normalizeSlashes(path.relative(repoRoot, entryPath));
          supportedFiles.add(entryRelPath);
          return {
            path: entryRelPath,
            kind: classifyInventoryKind(entryRelPath),
          };
        });
      const fingerprint = sha256(repoRelPath, markdown, JSON.stringify(inventory));
      const existing = skills.get(externalSkillKey);
      if (existing && existing.repoRelPath !== repoRelPath) {
        warnings.push({
          code: "identity_collision",
          message: `Skill identity '${externalSkillKey}' is defined by multiple files (${existing.repoRelPath}, ${repoRelPath}).`,
          repoRelPath,
          entityType: "skill",
          entityKey: externalSkillKey,
        });
        continue;
      }
      skills.set(externalSkillKey, {
        externalSkillKey,
        displayName,
        repoRelPath,
        markdown,
        fileInventory: inventory,
        fingerprint,
      });
    }
  }

  const standardAgentFiles = walkFiles(path.join(repoRoot, AGENT_ROOT))
    .filter((filePath) => {
      const repoRelPath = normalizeSlashes(path.relative(repoRoot, filePath));
      return !repoRelPath.startsWith(`${AGENT_COMPAT_ROOT}/`) && !repoRelPath.startsWith(`${LEGACY_SKILL_ROOT}/`);
    });
  const compatAgentFiles = walkFiles(path.join(repoRoot, AGENT_COMPAT_ROOT));
  const hasStandardAgentLayout = standardAgentFiles.some((filePath) => filePath.toLowerCase().endsWith(".md"));
  const hasCompatAgentLayout = compatAgentFiles.some((filePath) => filePath.toLowerCase().endsWith(".md"));

  if (hasStandardAgentLayout && hasCompatAgentLayout) {
    warnings.push({
      code: "ambiguous_repo_layout",
      message: `Agent files were found in both '${AGENT_ROOT}/**' and compatibility alias '${AGENT_COMPAT_ROOT}/**'. Cycle 2.2 blocks mixed agent layouts instead of merging them.`,
      repoRelPath: AGENT_ROOT,
      entityType: "workspace",
      entityKey: null,
    });
  }

  const agentFiles = hasStandardAgentLayout && hasCompatAgentLayout
    ? []
    : hasCompatAgentLayout
      ? compatAgentFiles
      : standardAgentFiles;

  for (const filePath of [...new Set(agentFiles.map((entry) => path.resolve(entry)))].sort((left, right) => left.localeCompare(right))) {
    const repoRelPath = normalizeSlashes(path.relative(repoRoot, filePath));
    if (!repoRelPath.toLowerCase().endsWith(".md")) continue;
    if (repoRelPath.startsWith(".opencode/agents/skills/")) continue;
    if (repoRelPath.startsWith(".opencode/skills/")) continue;
    supportedFiles.add(repoRelPath);

    const instructionsMarkdown = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontmatter(instructionsMarkdown);
    const externalAgentKey = deriveAgentExternalKey(repoRelPath);
    const displayName = String(parsed.attributes.name ?? extractHeading(parsed.body) ?? titleCase(path.basename(externalAgentKey))).trim();
    const role = typeof parsed.attributes.role === "string" ? parsed.attributes.role.trim() : null;
    const reportsToExternalKey = typeof parsed.attributes.reportsTo === "string"
      ? slugify(parsed.attributes.reportsTo)
      : typeof parsed.attributes.reports_to === "string"
        ? slugify(parsed.attributes.reports_to)
        : typeof parsed.attributes.manager === "string"
          ? slugify(parsed.attributes.manager)
          : null;
    const desiredSkillKeys = extractDesiredSkillKeys(parsed.attributes, instructionsMarkdown);
    const adapterDefaults = getAdapterDefaults(opencodeConfig);
    const fingerprint = sha256(repoRelPath, instructionsMarkdown, JSON.stringify(adapterDefaults), desiredSkillKeys.join(","));

    const existing = agents.get(externalAgentKey);
    if (existing && existing.repoRelPath !== repoRelPath) {
      warnings.push({
        code: "identity_collision",
        message: `Agent identity '${externalAgentKey}' is defined by multiple files (${existing.repoRelPath}, ${repoRelPath}).`,
        repoRelPath,
        entityType: "agent",
        entityKey: externalAgentKey,
      });
      continue;
    }

    agents.set(externalAgentKey, {
      externalAgentKey,
      displayName,
      role,
      repoRelPath,
      folderPath: deriveAgentFolderPath(repoRelPath),
      reportsToExternalKey,
      instructionsMarkdown,
      desiredSkillKeys,
      adapterDefaults,
      fingerprint,
    });
  }

  const orderedFiles = [...supportedFiles].sort((left, right) => left.localeCompare(right));
  const lastScanFingerprint = sha256(...orderedFiles.map((file) => `${file}:${isFile(path.join(repoRoot, file)) ? fs.readFileSync(path.join(repoRoot, file), "utf8") : "missing"}`));

  return {
    agents: [...agents.values()].sort((left, right) => left.externalAgentKey.localeCompare(right.externalAgentKey)),
    skills: [...skills.values()].sort((left, right) => left.externalSkillKey.localeCompare(right.externalSkillKey)),
    warnings,
    lastScanFingerprint,
    supportedFiles: orderedFiles,
    rootAgentsMarkdown,
    opencodeConfig,
  };
}

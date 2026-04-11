import * as path from "node:path";
import type { OpencodeProjectSyncState } from "./sync-state.js";
import type {
  ImportedOpencodeAgentMetadata,
  OpencodeProjectConflict,
  OpencodeProjectSyncManifestAgent,
  OpencodeProjectSyncManifestSkill,
} from "./schemas.js";
import { importedOpencodeAgentMetadataSchema } from "./schemas.js";

export type ExportablePaperclipAgent = {
  id: string;
  name: string;
  title: string | null;
  reportsTo: string | null;
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
};

export type ExportablePaperclipSkill = {
  id: string;
  name: string;
  slug: string;
  markdown: string;
};

export type ExportFilePlan = {
  entityType: "agent" | "skill";
  entityId: string;
  repoRelPath: string;
  content: string;
  fingerprint: string;
};

export type ExportPlan = {
  blocked: boolean;
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
  files: ExportFilePlan[];
};

type BuildExportPlanInput = {
  state: OpencodeProjectSyncState;
  currentRepoFingerprint: string;
  forceIfRepoUnchangedCheckFails: boolean;
  exportAgents: boolean;
  exportSkills: boolean;
  agents: ExportablePaperclipAgent[];
  skills: ExportablePaperclipSkill[];
};

function parseImportedAgentMetadata(metadata: Record<string, unknown> | null | undefined): ImportedOpencodeAgentMetadata | null {
  const parsed = importedOpencodeAgentMetadataSchema.safeParse(metadata ?? null);
  return parsed.success ? parsed.data : null;
}

function toAgentMarkdown(agent: ExportablePaperclipAgent, metadata: ImportedOpencodeAgentMetadata): string {
  const promptTemplate = typeof agent.adapterConfig.promptTemplate === "string"
    ? agent.adapterConfig.promptTemplate
    : `# ${agent.name}\n`;
  const desiredSkillBlock = metadata.desiredSkillKeys.length > 0
    ? `desiredSkills:\n${metadata.desiredSkillKeys.map((skillKey: string) => `  - ${skillKey}`).join("\n")}`
    : "desiredSkills: []";
  return [
    "---",
    `name: ${JSON.stringify(agent.name)}`,
    agent.title ? `role: ${JSON.stringify(agent.title)}` : undefined,
    metadata.reportsToExternalKey ? `reportsTo: ${JSON.stringify(metadata.reportsToExternalKey)}` : undefined,
    desiredSkillBlock,
    "---",
    "",
    promptTemplate.trimEnd(),
    "",
  ].filter((line) => line !== undefined).join("\n");
}

function toSkillMarkdown(skill: ExportablePaperclipSkill): string {
  return skill.markdown.endsWith("\n") ? skill.markdown : `${skill.markdown}\n`;
}

function normalizeRepoRelPath(repoRelPath: string): string | null {
  const normalized = repoRelPath.replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized)) return null;

  const canonical = path.posix.normalize(normalized);
  if (!canonical || canonical === "." || canonical === ".." || canonical.startsWith("../")) return null;
  if (canonical !== normalized) return null;

  return canonical;
}

function isAllowedAgentExportPath(repoRelPath: string): boolean {
  return repoRelPath.startsWith(".opencode/agents/") && !repoRelPath.startsWith(".opencode/agents/skills/");
}

function isAllowedSkillExportPath(repoRelPath: string): boolean {
  return repoRelPath === "AGENTS.md" || repoRelPath.startsWith(".opencode/skills/");
}

export function validateExportRepoRelPath(
  entityType: "agent" | "skill",
  repoRelPath: string,
): { ok: true; repoRelPath: string } | { ok: false; message: string } {
  const normalized = normalizeRepoRelPath(repoRelPath);
  if (!normalized) {
    return {
      ok: false,
      message: `Export target '${repoRelPath}' is not a canonical relative path inside the repo root.`,
    };
  }

  const allowed = entityType === "agent"
    ? isAllowedAgentExportPath(normalized)
    : isAllowedSkillExportPath(normalized);

  if (!allowed) {
    return {
      ok: false,
      message: `Export target '${normalized}' is outside the MVP ${entityType} export roots.`,
    };
  }

  return { ok: true, repoRelPath: normalized };
}

export function buildExportPlan(input: BuildExportPlanInput): ExportPlan {
  const warnings: string[] = [];
  const conflicts: OpencodeProjectConflict[] = [];

  if (
    input.state.lastScanFingerprint
    && input.state.lastScanFingerprint !== input.currentRepoFingerprint
    && !input.forceIfRepoUnchangedCheckFails
  ) {
    conflicts.push({
      code: "repo_changed_since_last_import",
      message: "The canonical repo changed since the last import. Re-import before exporting, or explicitly override the guard.",
      repoRelPath: null,
      entityType: "workspace",
      entityKey: null,
    });
    return {
      blocked: true,
      warnings,
      conflicts,
      files: [],
    };
  }

  const files: ExportFilePlan[] = [];
  const managedAgentIds = new Set(
    input.state.importedAgents.map((entry: OpencodeProjectSyncManifestAgent) => entry.paperclipAgentId),
  );
  const managedSkillIds = new Set(
    input.state.importedSkills.map((entry: OpencodeProjectSyncManifestSkill) => entry.paperclipSkillId),
  );

  if (input.exportAgents) {
    for (const agent of input.agents) {
      if (!managedAgentIds.has(agent.id)) continue;
      const metadata = parseImportedAgentMetadata(agent.metadata);
      if (!metadata?.syncManaged) {
        conflicts.push({
          code: "paperclip_entity_drift",
          message: `Agent '${agent.name}' is listed in the sync manifest but no longer carries valid sync-managed metadata.`,
          repoRelPath: null,
          entityType: "agent",
          entityKey: agent.id,
        });
        continue;
      }
      const validatedPath = validateExportRepoRelPath("agent", metadata.repoRelPath);
      if (!validatedPath.ok) {
        conflicts.push({
          code: "export_target_changed",
          message: validatedPath.message,
          repoRelPath: metadata.repoRelPath,
          entityType: "agent",
          entityKey: agent.id,
        });
        continue;
      }
      files.push({
        entityType: "agent",
        entityId: agent.id,
        repoRelPath: validatedPath.repoRelPath,
        content: toAgentMarkdown(agent, metadata),
        fingerprint: metadata.lastImportedFingerprint ?? metadata.repoRelPath,
      });
    }
  }

  if (input.exportSkills) {
    for (const skill of input.skills) {
      if (!managedSkillIds.has(skill.id)) continue;
      const manifestEntry = input.state.importedSkills.find(
        (entry: OpencodeProjectSyncManifestSkill) => entry.paperclipSkillId === skill.id,
      ) ?? null;
      if (!manifestEntry) continue;
      const validatedPath = validateExportRepoRelPath("skill", manifestEntry.repoRelPath);
      if (!validatedPath.ok) {
        conflicts.push({
          code: "export_target_changed",
          message: validatedPath.message,
          repoRelPath: manifestEntry.repoRelPath,
          entityType: "skill",
          entityKey: skill.id,
        });
        continue;
      }
      files.push({
        entityType: "skill",
        entityId: skill.id,
        repoRelPath: validatedPath.repoRelPath,
        content: toSkillMarkdown(skill),
        fingerprint: manifestEntry.fingerprint,
      });
    }
  }

  if (files.length === 0) {
    warnings.push("No sync-managed imported entities matched the requested export selection.");
  }

  return {
    blocked: conflicts.length > 0,
    warnings,
    conflicts,
    files,
  };
}

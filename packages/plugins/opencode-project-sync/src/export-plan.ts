import * as path from "node:path";
import type { OpencodeProjectSyncState } from "./sync-state.js";
import type {
  ImportedOpencodeAgentMetadata,
  OpencodeProjectConflict,
  OpencodeProjectSyncManifestAgent,
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

export type ExportFilePlan = {
  entityType: "agent";
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
  agents: ExportablePaperclipAgent[];
};

function parseImportedAgentMetadata(metadata: Record<string, unknown> | null | undefined): ImportedOpencodeAgentMetadata | null {
  const parsed = importedOpencodeAgentMetadataSchema.safeParse(metadata ?? null);
  return parsed.success ? parsed.data : null;
}

function toAgentMarkdown(agent: ExportablePaperclipAgent, metadata: ImportedOpencodeAgentMetadata): string {
  const promptTemplate = typeof agent.adapterConfig.promptTemplate === "string"
    ? agent.adapterConfig.promptTemplate
    : `# ${agent.name}\n`;
  return [
    "---",
    `name: ${JSON.stringify(agent.name)}`,
    agent.title ? `role: ${JSON.stringify(agent.title)}` : undefined,
    "---",
    "",
    promptTemplate.trimEnd(),
    "",
  ].filter((line) => line !== undefined).join("\n");
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
      code: "paperclip_entity_drift",
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
          code: "paperclip_entity_drift",
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

  if (files.length === 0) {
    warnings.push("No sync-managed imported agents matched the requested export selection.");
  }

  return {
    blocked: conflicts.length > 0,
    warnings,
    conflicts,
    files,
  };
}

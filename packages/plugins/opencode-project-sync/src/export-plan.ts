import * as fs from "node:fs";
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

export type ParsedAgentSourceDocument = {
  frontmatter: string | null;
  body: string;
  trailingNewline: boolean;
};

export type ExportFilePlan = {
  entityType: "agent";
  entityId: string;
  repoRelPath: string;
  fingerprint: string;
  sourceFingerprint: string;
  nextContent: string;
  parsedSource: ParsedAgentSourceDocument;
};

export type ExportPlan = {
  blocked: boolean;
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
  files: ExportFilePlan[];
};

type BuildExportPlanInput = {
  state: OpencodeProjectSyncState;
  repoRoot: string;
  currentRepoFingerprint: string;
  forceIfRepoUnchangedCheckFails: boolean;
  exportAgents: boolean;
  agents: ExportablePaperclipAgent[];
};

const AGENT_EXPORT_ROOT = ".opencode/agents/";

function parseImportedAgentMetadata(metadata: Record<string, unknown> | null | undefined): ImportedOpencodeAgentMetadata | null {
  const parsed = importedOpencodeAgentMetadataSchema.safeParse(metadata ?? null);
  return parsed.success ? parsed.data : null;
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
  if (!repoRelPath.startsWith(AGENT_EXPORT_ROOT)) return false;
  const relative = repoRelPath.slice(AGENT_EXPORT_ROOT.length);
  if (!relative || relative.includes("/")) return false;
  return relative.toLowerCase().endsWith(".md");
}

export function validateExportRepoRelPath(
  entityType: "agent",
  repoRelPath: string,
): { ok: true; repoRelPath: string } | { ok: false; message: string } {
  const normalized = normalizeRepoRelPath(repoRelPath);
  if (!normalized) {
    return {
      ok: false,
      message: `Export target '${repoRelPath}' is not a canonical relative path inside the repo root.`,
    };
  }

  if (entityType !== "agent" || !isAllowedAgentExportPath(normalized)) {
    return {
      ok: false,
      message: `Export target '${normalized}' is outside the MVP agent export roots.`,
    };
  }

  return { ok: true, repoRelPath: normalized };
}

export function parseAgentSourceDocument(markdown: string): ParsedAgentSourceDocument | null {
  const trailingNewline = markdown.endsWith("\n");
  if (!markdown.startsWith("---\n")) {
    return {
      frontmatter: null,
      body: markdown,
      trailingNewline,
    };
  }

  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return null;
  }

  const frontmatter = markdown.slice(0, endIndex + 5);
  const body = markdown.slice(endIndex + 5);
  return {
    frontmatter,
    body,
    trailingNewline,
  };
}

export function buildRoundTripAgentMarkdown(parsed: ParsedAgentSourceDocument, promptTemplate: string): string {
  const normalizedBody = promptTemplate.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/g, "");
  const combined = parsed.frontmatter
    ? `${parsed.frontmatter}${normalizedBody}`
    : normalizedBody;
  return parsed.trailingNewline || combined.length === 0 ? `${combined}\n` : combined;
}

function createDriftConflict(message: string, repoRelPath: string | null, entityKey: string | null): OpencodeProjectConflict {
  return {
    code: "paperclip_entity_drift",
    message,
    repoRelPath,
    entityType: "agent",
    entityKey,
  };
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

  const managedAgentIds = new Set(
    input.state.importedAgents.map((entry: OpencodeProjectSyncManifestAgent) => entry.paperclipAgentId),
  );
  const selectedAgentKeys = new Set(
    input.state.selectedAgents.map((entry: OpencodeProjectSyncState["selectedAgents"][number]) => entry.externalAgentKey),
  );

  const files: ExportFilePlan[] = [];
  if (input.exportAgents) {
    for (const agent of input.agents) {
      if (!managedAgentIds.has(agent.id)) continue;

      const metadata = parseImportedAgentMetadata(agent.metadata);
      if (!metadata?.syncManaged) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' is listed in the sync manifest but no longer carries valid sync-managed metadata.`,
          null,
          agent.id,
        ));
        continue;
      }

      if (!selectedAgentKeys.has(metadata.externalAgentKey)) {
        continue;
      }

      const manifestEntry = input.state.importedAgents.find(
        (entry: OpencodeProjectSyncManifestAgent) => entry.paperclipAgentId === agent.id,
      );
      if (!manifestEntry) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' is missing a stable sync manifest mapping and cannot be exported safely.`,
          metadata.repoRelPath,
          agent.id,
        ));
        continue;
      }

      if (
        manifestEntry.externalAgentKey !== metadata.externalAgentKey
        || manifestEntry.repoRelPath !== metadata.repoRelPath
      ) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' no longer matches its stable repo mapping and cannot be exported safely.`,
          metadata.repoRelPath,
          agent.id,
        ));
        continue;
      }

      const validatedPath = validateExportRepoRelPath("agent", metadata.repoRelPath);
      if (!validatedPath.ok) {
        conflicts.push(createDriftConflict(validatedPath.message, metadata.repoRelPath, agent.id));
        continue;
      }

      const sourcePath = path.join(input.repoRoot, validatedPath.repoRelPath);
      if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' cannot be exported because '${validatedPath.repoRelPath}' is missing from the repo.`,
          validatedPath.repoRelPath,
          agent.id,
        ));
        continue;
      }

      const currentSource = fs.readFileSync(sourcePath, "utf8");
      const parsedSource = parseAgentSourceDocument(currentSource);
      if (!parsedSource) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' cannot be exported safely because '${validatedPath.repoRelPath}' is not parseable as optional frontmatter plus markdown body.`,
          validatedPath.repoRelPath,
          agent.id,
        ));
        continue;
      }

      const currentFingerprint = manifestEntry.fingerprint;
      if (currentFingerprint !== metadata.lastImportedFingerprint) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' cannot be exported safely because its manifest/import fingerprint mapping is inconsistent.`,
          validatedPath.repoRelPath,
          agent.id,
        ));
        continue;
      }

      const promptTemplate = typeof agent.adapterConfig.promptTemplate === "string"
        ? agent.adapterConfig.promptTemplate
        : null;
      if (promptTemplate === null) {
        conflicts.push(createDriftConflict(
          `Agent '${agent.name}' is missing editable prompt content and cannot be exported safely.`,
          validatedPath.repoRelPath,
          agent.id,
        ));
        continue;
      }

      files.push({
        entityType: "agent",
        entityId: agent.id,
        repoRelPath: validatedPath.repoRelPath,
        fingerprint: currentFingerprint,
        sourceFingerprint: currentSource,
        parsedSource,
        nextContent: buildRoundTripAgentMarkdown(parsedSource, promptTemplate),
      });
    }
  }

  if (files.length === 0) {
    warnings.push("No sync-managed selected top-level agents matched the requested export selection.");
  }

  return {
    blocked: conflicts.length > 0,
    warnings,
    conflicts,
    files,
  };
}

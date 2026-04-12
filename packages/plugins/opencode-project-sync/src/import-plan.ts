import type { OpencodeProjectSyncState } from "./sync-state.js";
import type {
  ImportedOpencodeAgentMetadata,
  OpencodeProjectConflict,
  OpencodeProjectSourceOfTruth,
} from "./schemas.js";
import { importedOpencodeAgentMetadataSchema } from "./schemas.js";
import type { DiscoveredRepoAgent, DiscoveryWarning } from "./discovery.js";

export type MinimalPaperclipAgent = {
  id: string;
  name: string;
  title: string | null;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
};

export type PlannedAgentUpsert = {
  operation: "create" | "update";
  paperclipAgentId: string | null;
  externalAgentKey: string;
  repoRelPath: string;
  fingerprint: string;
  matchBasis: "new_agent" | "manifest_link" | "metadata_link";
  payload: {
    name: string;
    title: string | null;
    reportsTo: null;
    adapterType: string;
    adapterConfig: Record<string, unknown>;
    metadata: ImportedOpencodeAgentMetadata;
  };
};

export type ImportPlan = {
  sourceOfTruth: OpencodeProjectSourceOfTruth;
  skillUpserts: [];
  agentUpserts: PlannedAgentUpsert[];
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
};

type PriorImportedAgent = {
  paperclipAgentId: string;
  externalAgentKey: string;
  repoRelPath: string;
};

type ManagedAgentProvenance = {
  projectId: string;
  workspaceId: string;
  repoRelPath: string;
  externalAgentKey: string;
  syncPolicyMode: string;
  sourceSystem: string;
  syncManaged: boolean;
};

type BuildImportPlanInput = {
  companyId: string;
  projectId: string;
  workspaceId: string;
  repoRoot: string;
  sourceOfTruth: OpencodeProjectSourceOfTruth;
  discovery: {
    eligibleAgents: DiscoveredRepoAgent[];
    warnings: DiscoveryWarning[];
  };
  selectedAgentKeys: string[];
  existingState: OpencodeProjectSyncState | null;
  existingAgents: MinimalPaperclipAgent[];
  importedAt: string;
};

function toLocator(repoRoot: string, repoRelPath: string): string {
  return `${repoRoot}::${repoRelPath}`;
}

function toTitle(value: string): string {
  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function parseImportedAgentMetadata(metadata: Record<string, unknown> | null | undefined): ImportedOpencodeAgentMetadata | null {
  const parsed = importedOpencodeAgentMetadataSchema.safeParse(metadata ?? null);
  return parsed.success ? parsed.data : null;
}

function parseManagedAgentProvenance(metadata: Record<string, unknown> | null | undefined): ManagedAgentProvenance | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  if (record.syncManaged !== true) return null;
  if (typeof record.projectId !== "string") return null;
  if (typeof record.workspaceId !== "string") return null;
  if (typeof record.repoRelPath !== "string") return null;
  if (typeof record.externalAgentKey !== "string") return null;
  if (typeof record.syncPolicyMode !== "string") return null;
  if (typeof record.sourceSystem !== "string") return null;
  return {
    projectId: record.projectId,
    workspaceId: record.workspaceId,
    repoRelPath: record.repoRelPath,
    externalAgentKey: record.externalAgentKey,
    syncPolicyMode: record.syncPolicyMode,
    sourceSystem: record.sourceSystem,
    syncManaged: true,
  };
}

function createConflictsFromDiscoveryWarnings(warnings: DiscoveryWarning[]): OpencodeProjectConflict[] {
  return warnings
    .filter(
      (
        warning,
      ): warning is DiscoveryWarning & { code: "identity_collision" } => (
        warning.code === "identity_collision"
      ),
    )
    .map((warning) => ({
      code: warning.code,
      message: warning.message,
      repoRelPath: warning.repoRelPath,
      entityType: warning.entityType,
      entityKey: warning.entityKey,
    }));
}

export function buildImportPlan(input: BuildImportPlanInput): ImportPlan {
  const conflicts = createConflictsFromDiscoveryWarnings(input.discovery.warnings);
  const warnings = input.discovery.warnings
    .filter((warning) => warning.code !== "identity_collision")
    .map((warning) => warning.message);

  const priorAgentManifest = new Map<string, PriorImportedAgent>(
    (input.existingState?.importedAgents ?? []).map((entry: OpencodeProjectSyncState["importedAgents"][number]) => {
      const typedEntry = entry as PriorImportedAgent;
      return [typedEntry.externalAgentKey, typedEntry] as const;
    }),
  );
  const existingAgentsById = new Map(input.existingAgents.map((agent) => [agent.id, agent]));
  const existingManagedAgentsByProvenance = new Map<string, MinimalPaperclipAgent[]>();
  for (const agent of input.existingAgents) {
    const provenance = parseManagedAgentProvenance(agent.metadata);
    if (!provenance) continue;
    if (provenance.projectId !== input.projectId || provenance.workspaceId !== input.workspaceId) continue;
    const key = `${provenance.repoRelPath}::${provenance.externalAgentKey}`;
    const matches = existingManagedAgentsByProvenance.get(key) ?? [];
    matches.push(agent);
    existingManagedAgentsByProvenance.set(key, matches);
  }

  const eligibleAgentsByKey = new Map(
    input.discovery.eligibleAgents.map((agent) => [agent.externalAgentKey, agent] as const),
  );
  for (const externalAgentKey of input.selectedAgentKeys) {
    if (eligibleAgentsByKey.has(externalAgentKey)) continue;
    conflicts.push({
      code: "invalid_selection",
      message: `Selected agent '${externalAgentKey}' is not currently eligible for top-level import. Refresh discovery and choose from the current top-level set.`,
      repoRelPath: null,
      entityType: "agent",
      entityKey: externalAgentKey,
    });
  }

  const agentUpserts: PlannedAgentUpsert[] = [];
  for (const externalAgentKey of input.selectedAgentKeys) {
    const discoveredAgent = eligibleAgentsByKey.get(externalAgentKey);
    if (!discoveredAgent) continue;
    const locator = toLocator(input.repoRoot, discoveredAgent.repoRelPath);
    const priorManifest = priorAgentManifest.get(discoveredAgent.externalAgentKey) ?? null;
    const manifestMatch = priorManifest?.paperclipAgentId ? existingAgentsById.get(priorManifest.paperclipAgentId) ?? null : null;
    const provenanceMatches = existingManagedAgentsByProvenance.get(
      `${discoveredAgent.repoRelPath}::${discoveredAgent.externalAgentKey}`,
    ) ?? [];

    if (provenanceMatches.length > 1) {
      conflicts.push({
        code: "paperclip_entity_drift",
        message: `Multiple Paperclip agents claim sync-managed provenance for '${discoveredAgent.externalAgentKey}'. Resolve the duplicate managed records before importing again.`,
        repoRelPath: discoveredAgent.repoRelPath,
        entityType: "agent",
        entityKey: discoveredAgent.externalAgentKey,
      });
      continue;
    }

    if (manifestMatch) {
      const manifestProvenance = parseManagedAgentProvenance(manifestMatch.metadata);
      const manifestMatchesSelection = Boolean(
        manifestProvenance
        && manifestProvenance.projectId === input.projectId
        && manifestProvenance.workspaceId === input.workspaceId
        && manifestProvenance.repoRelPath === discoveredAgent.repoRelPath
        && manifestProvenance.externalAgentKey === discoveredAgent.externalAgentKey
        && manifestProvenance.syncPolicyMode === "top_level_agents_only"
        && manifestProvenance.sourceSystem === "opencode_project_repo",
      );
      if (!manifestMatchesSelection) {
        conflicts.push({
          code: "paperclip_entity_drift",
          message: `Manifest-linked Paperclip agent '${manifestMatch.id}' no longer matches the expected top-level sync provenance for '${discoveredAgent.externalAgentKey}'.`,
          repoRelPath: discoveredAgent.repoRelPath,
          entityType: "agent",
          entityKey: manifestMatch.id,
        });
        continue;
      }
      if (provenanceMatches.length === 1 && provenanceMatches[0]?.id !== manifestMatch.id) {
        conflicts.push({
          code: "paperclip_entity_drift",
          message: `Manifest-linked agent '${manifestMatch.id}' and metadata-linked agent '${provenanceMatches[0].id}' disagree for '${discoveredAgent.externalAgentKey}'.`,
          repoRelPath: discoveredAgent.repoRelPath,
          entityType: "agent",
          entityKey: discoveredAgent.externalAgentKey,
        });
        continue;
      }
    }

    const metadataMatch = manifestMatch ? null : provenanceMatches[0] ?? null;
    const existing = manifestMatch ?? metadataMatch ?? null;

    const existingMetadata = existing ? parseImportedAgentMetadata(existing.metadata) : null;
    const metadata: ImportedOpencodeAgentMetadata = {
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      syncPolicyMode: "top_level_agents_only",
      sourceOfTruth: input.sourceOfTruth,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      repoRoot: input.repoRoot,
      repoRelPath: discoveredAgent.repoRelPath,
      canonicalLocator: locator,
      externalAgentKey: discoveredAgent.externalAgentKey,
      externalAgentName: discoveredAgent.displayName,
      importRole: "facade_entrypoint",
      topLevelAgent: true,
      lastImportedFingerprint: discoveredAgent.fingerprint,
      lastImportedAt: input.importedAt,
      lastExportedFingerprint: existingMetadata?.lastExportedFingerprint ?? null,
      lastExportedAt: existingMetadata?.lastExportedAt ?? null,
    };

    agentUpserts.push({
      operation: existing ? "update" : "create",
      paperclipAgentId: existing?.id ?? null,
      externalAgentKey: discoveredAgent.externalAgentKey,
      repoRelPath: discoveredAgent.repoRelPath,
      fingerprint: discoveredAgent.fingerprint,
      matchBasis: manifestMatch ? "manifest_link" : metadataMatch ? "metadata_link" : "new_agent",
      payload: {
        name: discoveredAgent.displayName || toTitle(discoveredAgent.externalAgentKey),
        title: discoveredAgent.role ?? null,
        reportsTo: null,
        adapterType: existing?.adapterType ?? "opencode_project_local",
        adapterConfig: {
          ...(existing?.adapterConfig ?? {}),
          allowProjectConfig: true,
          syncPluginKey: "paperclip-opencode-project",
          promptTemplate: discoveredAgent.instructionsMarkdown,
        },
        metadata,
      },
    });
  }

  return {
    sourceOfTruth: input.sourceOfTruth,
    skillUpserts: [],
    agentUpserts,
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
    conflicts,
  };
}

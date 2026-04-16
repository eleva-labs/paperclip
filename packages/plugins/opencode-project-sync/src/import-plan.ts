import { DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL } from "@paperclipai/shared";
import type { OpencodeProjectSyncState } from "./sync-state.js";
import type {
  ImportedOpencodeAgentMetadata,
  OpencodeProjectConflict,
  OpencodeProjectSourceOfTruth,
} from "./schemas.js";
import { importedOpencodeAgentMetadataSchema } from "./schemas.js";
import type { DiscoveredRepoAgent, DiscoveryWarning } from "./discovery.js";

const DEFAULT_OPENCODE_FULL_EXECUTION_MODE = "local_cli" as const;
const DEFAULT_OPENCODE_FULL_TIMEOUT_SEC = 120;
const DEFAULT_OPENCODE_FULL_CONNECT_TIMEOUT_SEC = 10;
const DEFAULT_OPENCODE_FULL_EVENT_STREAM_IDLE_TIMEOUT_SEC = 30;
const DEFAULT_OPENCODE_FULL_FAIL_FAST_WHEN_UNAVAILABLE = true;
const DEFAULT_OPENCODE_FULL_LOCAL_CLI_COMMAND = "opencode";
const DEFAULT_OPENCODE_FULL_LOCAL_CLI_GRACE_SEC = 5;
const DEFAULT_OPENCODE_FULL_REMOTE_HEALTH_TIMEOUT_SEC = 10;
const DEFAULT_OPENCODE_FULL_REMOTE_REQUIRE_HEALTHY_SERVER = true;

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

function asConfiguredModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[^\s/]+\/[^\s/]+$/.test(trimmed) ? trimmed : null;
}

function resolveImportedAgentModel(input: {
  discoveredAgent: DiscoveredRepoAgent;
  existing: MinimalPaperclipAgent | null;
}): string {
  return input.discoveredAgent.frontmatter.model
    ?? asConfiguredModel(input.existing?.adapterConfig?.model)
    ?? DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function withSharedOpencodeFullDefaults(baseConfig: Record<string, unknown>): Record<string, unknown> {
  return {
    timeoutSec: DEFAULT_OPENCODE_FULL_TIMEOUT_SEC,
    connectTimeoutSec: DEFAULT_OPENCODE_FULL_CONNECT_TIMEOUT_SEC,
    eventStreamIdleTimeoutSec: DEFAULT_OPENCODE_FULL_EVENT_STREAM_IDLE_TIMEOUT_SEC,
    failFastWhenUnavailable: DEFAULT_OPENCODE_FULL_FAIL_FAST_WHEN_UNAVAILABLE,
    ...baseConfig,
  };
}

function buildImportedAgentAdapterConfig(input: {
  discoveredAgent: DiscoveredRepoAgent;
  existing: MinimalPaperclipAgent | null;
  resolvedModel: string;
}): Record<string, unknown> {
  const existingConfig = asRecord(input.existing?.adapterConfig) ?? {};
  const executionMode = existingConfig.executionMode === "remote_server"
    || existingConfig.executionMode === "local_sdk"
    || existingConfig.executionMode === "local_cli"
    ? existingConfig.executionMode
    : DEFAULT_OPENCODE_FULL_EXECUTION_MODE;

  const baseConfig: Record<string, unknown> = {
    executionMode,
    model: input.resolvedModel,
    promptTemplate: input.discoveredAgent.instructionsMarkdown,
  };

  for (const key of [
    "variant",
    "bootstrapPromptTemplate",
    "timeoutSec",
    "connectTimeoutSec",
    "eventStreamIdleTimeoutSec",
    "failFastWhenUnavailable",
  ]) {
    if (key in existingConfig) {
      baseConfig[key] = existingConfig[key];
    }
  }

  if (executionMode === "remote_server") {
    const remoteServer = asRecord(existingConfig.remoteServer) ?? {};
    return withSharedOpencodeFullDefaults({
      ...baseConfig,
      remoteServer: {
        ...remoteServer,
        auth: asRecord(remoteServer.auth) ?? { mode: "none" },
        healthTimeoutSec: DEFAULT_OPENCODE_FULL_REMOTE_HEALTH_TIMEOUT_SEC,
        requireHealthyServer: DEFAULT_OPENCODE_FULL_REMOTE_REQUIRE_HEALTHY_SERVER,
        ...remoteServer,
        projectTarget: { mode: "server_default" },
      },
    });
  }

  if (executionMode === "local_sdk") {
    return withSharedOpencodeFullDefaults({
      ...baseConfig,
      localSdk: asRecord(existingConfig.localSdk) ?? {},
    });
  }

  return withSharedOpencodeFullDefaults({
    ...baseConfig,
    localCli: {
      command: DEFAULT_OPENCODE_FULL_LOCAL_CLI_COMMAND,
      allowProjectConfig: true,
      dangerouslySkipPermissions: false,
      graceSec: DEFAULT_OPENCODE_FULL_LOCAL_CLI_GRACE_SEC,
      env: {},
      ...asRecord(existingConfig.localCli),
    },
  });
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
    const resolvedModel = resolveImportedAgentModel({ discoveredAgent, existing });

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
        adapterType: "opencode_full",
        adapterConfig: buildImportedAgentAdapterConfig({
          discoveredAgent,
          existing,
          resolvedModel,
        }),
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

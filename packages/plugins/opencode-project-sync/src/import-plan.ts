import type { OpencodeProjectSyncState } from "./sync-state.js";
import type {
  ImportedOpencodeAgentMetadata,
  OpencodeProjectConflict,
  OpencodeProjectSourceOfTruth,
} from "./schemas.js";
import { importedOpencodeAgentMetadataSchema } from "./schemas.js";
import type { DiscoveredRepoAgent, DiscoveredRepoSkill, DiscoveryWarning } from "./discovery.js";

export type MinimalPaperclipAgent = {
  id: string;
  name: string;
  title: string | null;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
};

export type MinimalPaperclipSkill = {
  id: string;
  key: string;
  slug: string;
  name: string;
};

export type PlannedSkillUpsert = {
  operation: "create" | "update";
  paperclipSkillId: string | null;
  externalSkillKey: string;
  repoRelPath: string;
  fingerprint: string;
  payload: {
    name: string;
    slug: string;
    markdown: string;
    filePath: string;
  };
};

export type PlannedAgentUpsert = {
  operation: "create" | "update";
  paperclipAgentId: string | null;
  externalAgentKey: string;
  repoRelPath: string;
  fingerprint: string;
  desiredSkillKeys: string[];
  payload: {
    name: string;
    title: string | null;
    reportsToExternalKey: string | null;
    adapterType: string;
    adapterConfig: Record<string, unknown>;
    metadata: ImportedOpencodeAgentMetadata;
  };
};

export type ImportPlan = {
  sourceOfTruth: OpencodeProjectSourceOfTruth;
  skillUpserts: PlannedSkillUpsert[];
  agentUpserts: PlannedAgentUpsert[];
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
};

type PriorImportedAgent = {
  paperclipAgentId: string;
  externalAgentKey: string;
};

type PriorImportedSkill = {
  paperclipSkillId: string;
  externalSkillKey: string;
};

type BuildImportPlanInput = {
  companyId: string;
  projectId: string;
  workspaceId: string;
  repoRoot: string;
  sourceOfTruth: OpencodeProjectSourceOfTruth;
  discovery: {
    agents: DiscoveredRepoAgent[];
    skills: DiscoveredRepoSkill[];
    warnings: DiscoveryWarning[];
  };
  existingState: OpencodeProjectSyncState | null;
  existingAgents: MinimalPaperclipAgent[];
  existingSkills: MinimalPaperclipSkill[];
  importedAt: string;
};

function toLocator(repoRoot: string, repoRelPath: string): string {
  return `${repoRoot}::${repoRelPath}`;
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
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

function createConflictsFromDiscoveryWarnings(warnings: DiscoveryWarning[]): OpencodeProjectConflict[] {
  return warnings
    .filter(
      (
        warning,
      ): warning is DiscoveryWarning & { code: "identity_collision" | "ambiguous_repo_layout" } => (
        warning.code === "identity_collision" || warning.code === "ambiguous_repo_layout"
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
    .filter((warning) => warning.code === "invalid_repo_file")
    .map((warning) => warning.message);

  const priorAgentManifest = new Map<string, PriorImportedAgent>(
    (input.existingState?.importedAgents ?? []).map((entry: OpencodeProjectSyncState["importedAgents"][number]) => {
      const typedEntry = entry as PriorImportedAgent;
      return [typedEntry.externalAgentKey, typedEntry] as const;
    }),
  );
  const priorSkillManifest = new Map<string, PriorImportedSkill>(
    (input.existingState?.importedSkills ?? []).map((entry: OpencodeProjectSyncState["importedSkills"][number]) => {
      const typedEntry = entry as PriorImportedSkill;
      return [typedEntry.externalSkillKey, typedEntry] as const;
    }),
  );

  const existingAgentsById = new Map(input.existingAgents.map((agent) => [agent.id, agent]));
  const existingManagedAgents = new Map<string, MinimalPaperclipAgent>();
  for (const agent of input.existingAgents) {
    const metadata = parseImportedAgentMetadata(agent.metadata);
    if (!metadata) continue;
    if (metadata.projectId !== input.projectId || metadata.workspaceId !== input.workspaceId) continue;
    existingManagedAgents.set(metadata.externalAgentKey, agent);
  }

  const existingSkillsById = new Map(input.existingSkills.map((skill) => [skill.id, skill]));
  const existingSkillsBySlug = new Map(input.existingSkills.map((skill) => [skill.slug, skill]));

  const skillUpserts: PlannedSkillUpsert[] = [];
  for (const discoveredSkill of input.discovery.skills) {
    const priorManifest = priorSkillManifest.get(discoveredSkill.externalSkillKey) ?? null;
    const slug = toSlug(discoveredSkill.externalSkillKey);
    const manifestMatch = priorManifest?.paperclipSkillId ? existingSkillsById.get(priorManifest.paperclipSkillId) ?? null : null;
    const slugMatch = existingSkillsBySlug.get(slug) ?? null;
    const existing = manifestMatch ?? slugMatch;

    skillUpserts.push({
      operation: existing ? "update" : "create",
      paperclipSkillId: existing?.id ?? null,
      externalSkillKey: discoveredSkill.externalSkillKey,
      repoRelPath: discoveredSkill.repoRelPath,
      fingerprint: discoveredSkill.fingerprint,
      payload: {
        name: discoveredSkill.displayName || toTitle(discoveredSkill.externalSkillKey),
        slug,
        markdown: discoveredSkill.markdown,
        filePath: discoveredSkill.repoRelPath,
      },
    });
  }

  const knownSkillKeys = new Set(skillUpserts.map((entry) => entry.externalSkillKey));
  const agentUpserts: PlannedAgentUpsert[] = [];
  for (const discoveredAgent of input.discovery.agents) {
    const locator = toLocator(input.repoRoot, discoveredAgent.repoRelPath);
    const priorManifest = priorAgentManifest.get(discoveredAgent.externalAgentKey) ?? null;
    const manifestMatch = priorManifest?.paperclipAgentId ? existingAgentsById.get(priorManifest.paperclipAgentId) ?? null : null;
    const managedMatch = existingManagedAgents.get(discoveredAgent.externalAgentKey) ?? null;
    const existing = manifestMatch ?? managedMatch ?? null;

    const unresolvedSkillKeys = discoveredAgent.desiredSkillKeys.filter((skillKey) => !knownSkillKeys.has(skillKey));
    if (unresolvedSkillKeys.length > 0) {
      warnings.push(
        `Agent '${discoveredAgent.displayName}' references unknown repo skill keys: ${unresolvedSkillKeys.join(", ")}.`,
      );
    }

    const existingMetadata = existing ? parseImportedAgentMetadata(existing.metadata) : null;
    const metadata: ImportedOpencodeAgentMetadata = {
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      sourceOfTruth: input.sourceOfTruth,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      repoRoot: input.repoRoot,
      repoRelPath: discoveredAgent.repoRelPath,
      canonicalLocator: locator,
      externalAgentKey: discoveredAgent.externalAgentKey,
      externalAgentName: discoveredAgent.displayName,
      folderPath: discoveredAgent.folderPath,
      hierarchyMode: discoveredAgent.reportsToExternalKey ? "reports_to" : "metadata_only",
      reportsToExternalKey: discoveredAgent.reportsToExternalKey,
      desiredSkillKeys: discoveredAgent.desiredSkillKeys,
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
      desiredSkillKeys: discoveredAgent.desiredSkillKeys.filter((skillKey) => knownSkillKeys.has(skillKey)),
      payload: {
        name: discoveredAgent.displayName || toTitle(discoveredAgent.externalAgentKey),
        title: discoveredAgent.role ?? null,
        reportsToExternalKey: discoveredAgent.reportsToExternalKey,
        adapterType: existing?.adapterType ?? "opencode_project_local",
        adapterConfig: {
          ...(existing?.adapterConfig ?? {}),
          ...discoveredAgent.adapterDefaults,
          allowProjectConfig: true,
          syncPluginKey: "paperclip-opencode-project",
          promptTemplate: discoveredAgent.instructionsMarkdown,
        },
        metadata,
      },
    });
  }

  const discoveredAgentKeys = new Set(agentUpserts.map((entry) => entry.externalAgentKey));
  for (const entry of agentUpserts) {
    const managerKey = entry.payload.reportsToExternalKey;
    if (managerKey && !discoveredAgentKeys.has(managerKey) && !existingManagedAgents.has(managerKey)) {
      warnings.push(`Agent '${entry.payload.name}' reports to unknown agent key '${managerKey}'.`);
    }
  }

  return {
    sourceOfTruth: input.sourceOfTruth,
    skillUpserts,
    agentUpserts,
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
    conflicts,
  };
}

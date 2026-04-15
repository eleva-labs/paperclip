import { z } from "@paperclipai/plugin-sdk";

export const opencodeProjectSourceOfTruthSchema = z.enum([
  "repo_first",
  "paperclip_export_guarded",
]);

export const opencodeProjectSyncPolicySchema = z.object({
  mode: z.literal("top_level_agents_only"),
  syncSkills: z.literal(false),
  importRootAgentsMd: z.literal(false),
  importNestedAgents: z.literal(false),
}).strict();

export const opencodeEligibleAgentSchema = z.object({
  externalAgentKey: z.string().min(1),
  displayName: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  role: z.string().min(1).nullable(),
  advisoryMode: z.enum(["primary", "subagent"]).nullable(),
  selectionDefault: z.boolean(),
  frontmatter: z.object({
    model: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export const opencodeIneligibleNestedAgentSchema = z.object({
  externalAgentKey: z.string().min(1),
  displayName: z.string().min(1),
  repoRelPath: z.string().min(1),
}).strict();

export const opencodeIgnoredArtifactSchema = z.object({
  kind: z.enum(["skill", "root_agents_md", "other"]),
  repoRelPath: z.string().min(1),
}).strict();

export const opencodeTopLevelAgentPreviewSchema = z.object({
  lastScanFingerprint: z.string().min(1),
  eligibleAgents: z.array(opencodeEligibleAgentSchema),
  ineligibleNestedAgents: z.array(opencodeIneligibleNestedAgentSchema),
  ignoredArtifacts: z.array(opencodeIgnoredArtifactSchema),
  warnings: z.array(z.string()),
}).strict();

export const opencodeSelectedAgentSchema = z.object({
  externalAgentKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  selectedAt: z.string().datetime(),
}).strict();

export const opencodeLegacyOutOfScopeEntitySchema = z.object({
  entityType: z.enum(["agent", "skill"]),
  paperclipId: z.string().uuid(),
  externalKey: z.string().min(1),
  repoRelPath: z.string().min(1).nullable(),
  reason: z.enum([
    "nested_agent_no_longer_supported",
    "skill_sync_removed",
    "root_agents_md_no_longer_supported",
  ]),
  detectedAt: z.string().datetime(),
});

export const opencodeProjectResolveWorkspaceInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const opencodeProjectSyncNowInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  mode: z.enum(["bootstrap", "import", "refresh"]).default("import"),
  dryRun: z.boolean().default(false),
  selectedAgentKeys: z.array(z.string().min(1)).default([]),
});

export const opencodeProjectExportInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  exportAgents: z.boolean().default(true),
  forceIfRepoUnchangedCheckFails: z.boolean().default(false),
});

export const opencodeProjectTestRuntimeInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  workspaceMode: z.enum(["canonical", "resolved_execution_workspace"]).default("canonical"),
});

export const opencodeProjectConflictSchema = z.object({
  code: z.enum([
    "identity_collision",
    "invalid_selection",
    "paperclip_entity_drift",
  ]),
  message: z.string().min(1),
  repoRelPath: z.string().min(1).nullable(),
  entityType: z.enum(["agent", "workspace"]).nullable(),
  entityKey: z.string().min(1).nullable(),
}).strict();

export const opencodeImportedAgentRemoteAuthSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("bearer"), token: z.unknown() }).strict(),
  z.object({ mode: z.literal("basic"), username: z.string().min(1), password: z.unknown() }).strict(),
  z.object({ mode: z.literal("header"), headerName: z.string().min(1), headerValue: z.unknown() }).strict(),
]);

export const opencodeImportedAgentAdapterConfigSchema = z.discriminatedUnion("executionMode", [
  z.object({
    executionMode: z.literal("local_cli"),
    model: z.string().min(1),
    variant: z.string().min(1).optional(),
    promptTemplate: z.string(),
    bootstrapPromptTemplate: z.string().optional(),
    timeoutSec: z.number().int().positive().optional(),
    connectTimeoutSec: z.number().int().positive().optional(),
    eventStreamIdleTimeoutSec: z.number().int().positive().optional(),
    failFastWhenUnavailable: z.boolean().optional(),
    localCli: z.object({
      command: z.string().min(1).optional(),
      allowProjectConfig: z.boolean().optional(),
      dangerouslySkipPermissions: z.boolean().optional(),
      graceSec: z.number().int().nonnegative().optional(),
      env: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  }).strict(),
  z.object({
    executionMode: z.literal("remote_server"),
    model: z.string().min(1),
    variant: z.string().min(1).optional(),
    promptTemplate: z.string(),
    bootstrapPromptTemplate: z.string().optional(),
    timeoutSec: z.number().int().positive().optional(),
    connectTimeoutSec: z.number().int().positive().optional(),
    eventStreamIdleTimeoutSec: z.number().int().positive().optional(),
    failFastWhenUnavailable: z.boolean().optional(),
    remoteServer: z.object({
      baseUrl: z.string().min(1),
      auth: opencodeImportedAgentRemoteAuthSchema.optional(),
      healthTimeoutSec: z.number().int().positive().optional(),
      requireHealthyServer: z.boolean().optional(),
      projectTarget: z.object({ mode: z.literal("server_default") }).strict().optional(),
    }).strict(),
  }).strict(),
  z.object({
    executionMode: z.literal("local_sdk"),
    model: z.string().min(1),
    variant: z.string().min(1).optional(),
    promptTemplate: z.string(),
    bootstrapPromptTemplate: z.string().optional(),
    timeoutSec: z.number().int().positive().optional(),
    connectTimeoutSec: z.number().int().positive().optional(),
    eventStreamIdleTimeoutSec: z.number().int().positive().optional(),
    failFastWhenUnavailable: z.boolean().optional(),
    localSdk: z.object({
      sdkProviderHint: z.string().min(1).optional(),
      allowProjectConfig: z.boolean().optional(),
      env: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  }).strict(),
]);

export const importedOpencodeFacadeAgentMetadataSchema = z.object({
  syncManaged: z.literal(true),
  sourceSystem: z.literal("opencode_project_repo"),
  syncPolicyMode: z.literal("top_level_agents_only"),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema.optional(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  repoRoot: z.string().min(1),
  repoRelPath: z.string().min(1),
  canonicalLocator: z.string().min(1),
  externalAgentKey: z.string().min(1),
  externalAgentName: z.string().min(1),
  importRole: z.literal("facade_entrypoint"),
  topLevelAgent: z.literal(true),
  folderPath: z.string().min(1).nullable().optional(),
  hierarchyMode: z.enum(["reports_to", "metadata_only"]).optional(),
  reportsToExternalKey: z.string().min(1).nullable().optional(),
  desiredSkillKeys: z.array(z.string().min(1)).optional(),
  lastImportedFingerprint: z.string().min(1).nullable(),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedFingerprint: z.string().min(1).nullable(),
  lastExportedAt: z.string().datetime().nullable(),
}).strict();

export const importedOpencodeAgentMetadataSchema = importedOpencodeFacadeAgentMetadataSchema;

export const importedOpencodeSkillMetadataSchema = z.object({
  syncManaged: z.literal(true),
  sourceSystem: z.literal("opencode_project_repo"),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema,
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  repoRoot: z.string().min(1),
  repoRelPath: z.string().min(1),
  canonicalLocator: z.string().min(1),
  externalSkillKey: z.string().min(1),
  externalSkillName: z.string().min(1),
  lastImportedFingerprint: z.string().min(1).nullable(),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedFingerprint: z.string().min(1).nullable(),
  lastExportedAt: z.string().datetime().nullable(),
});

export const opencodeProjectPlannedSkillUpsertSchema = z.array(z.never()).max(0);

export const opencodeProjectPlannedAgentUpsertSchema = z.object({
  operation: z.enum(["create", "update"]),
  paperclipAgentId: z.string().uuid().nullable(),
  externalAgentKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  matchBasis: z.enum(["new_agent", "manifest_link", "metadata_link"]),
  payload: z.object({
    name: z.string().min(1),
    title: z.string().min(1).nullable(),
    reportsTo: z.null(),
    adapterType: z.literal("opencode_full"),
    adapterConfig: opencodeImportedAgentAdapterConfigSchema,
    metadata: importedOpencodeFacadeAgentMetadataSchema,
  }).strict(),
}).strict();

export const opencodeProjectSyncPlanResultSchema = z.object({
  ok: z.literal(true),
  dryRun: z.boolean(),
  workspaceId: z.string().uuid(),
  importedAgentCount: z.number().int().nonnegative(),
  updatedAgentCount: z.number().int().nonnegative(),
  importedSkillCount: z.literal(0),
  updatedSkillCount: z.literal(0),
  warnings: z.array(z.string()),
  conflicts: z.array(opencodeProjectConflictSchema),
  lastScanFingerprint: z.string().min(1),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema,
  preview: opencodeTopLevelAgentPreviewSchema.optional(),
  agentUpserts: z.array(opencodeProjectPlannedAgentUpsertSchema),
  skillUpserts: z.array(z.never()).default([]),
});

export const opencodeProjectAppliedSkillResultSchema = z.array(z.never()).max(0);

export const opencodeProjectAppliedAgentResultSchema = z.object({
  externalAgentKey: z.string().min(1),
  paperclipAgentId: z.string().uuid(),
}).strict();

export const opencodeProjectFinalizeSyncInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  importedAt: z.string().datetime(),
  lastScanFingerprint: z.string().min(1),
  selectedAgentKeys: z.array(z.string().min(1)),
  warnings: z.array(z.string()),
  agentUpserts: z.array(z.object({
    operation: z.enum(["create", "update"]),
    paperclipAgentId: z.string().uuid().nullable(),
    externalAgentKey: z.string().min(1),
    repoRelPath: z.string().min(1),
    fingerprint: z.string().min(1),
  }).strict()),
  appliedAgents: z.array(opencodeProjectAppliedAgentResultSchema),
}).strict();

export const opencodeProjectSyncManifestAgentSchema = z.object({
  paperclipAgentId: z.string().uuid(),
  externalAgentKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  canonicalLocator: z.string().min(1),
  externalAgentName: z.string().min(1),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedFingerprint: z.string().min(1).nullable(),
  lastExportedAt: z.string().datetime().nullable(),
}).strict();

export const opencodeProjectSyncManifestSkillSchema = z.object({
  paperclipSkillId: z.string().uuid(),
  externalSkillKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  canonicalLocator: z.string().min(1).optional(),
  externalSkillName: z.string().min(1).optional(),
  lastImportedAt: z.string().datetime().nullable().optional(),
  lastExportedFingerprint: z.string().min(1).nullable().optional(),
  lastExportedAt: z.string().datetime().nullable().optional(),
});

export type OpencodeProjectSourceOfTruth = z.infer<typeof opencodeProjectSourceOfTruthSchema>;
export type OpencodeProjectSyncPolicy = z.infer<typeof opencodeProjectSyncPolicySchema>;
export type OpencodeEligibleAgent = z.infer<typeof opencodeEligibleAgentSchema>;
export type OpencodeIneligibleNestedAgent = z.infer<typeof opencodeIneligibleNestedAgentSchema>;
export type OpencodeIgnoredArtifact = z.infer<typeof opencodeIgnoredArtifactSchema>;
export type OpencodeTopLevelAgentPreview = z.infer<typeof opencodeTopLevelAgentPreviewSchema>;
export type OpencodeSelectedAgent = z.infer<typeof opencodeSelectedAgentSchema>;
export type OpencodeLegacyOutOfScopeEntity = z.infer<typeof opencodeLegacyOutOfScopeEntitySchema>;
export type OpencodeProjectResolveWorkspaceInput = z.infer<typeof opencodeProjectResolveWorkspaceInputSchema>;
export type OpencodeProjectSyncNowInput = z.infer<typeof opencodeProjectSyncNowInputSchema>;
export type OpencodeProjectExportInput = z.infer<typeof opencodeProjectExportInputSchema>;
export type OpencodeProjectTestRuntimeInput = z.infer<typeof opencodeProjectTestRuntimeInputSchema>;
export type OpencodeProjectSyncManifestAgent = z.infer<typeof opencodeProjectSyncManifestAgentSchema>;
export type OpencodeProjectSyncManifestSkill = z.infer<typeof opencodeProjectSyncManifestSkillSchema>;
export type OpencodeProjectConflict = z.infer<typeof opencodeProjectConflictSchema>;
export type ImportedOpencodeFacadeAgentMetadata = z.infer<typeof importedOpencodeFacadeAgentMetadataSchema>;
export type ImportedOpencodeAgentMetadata = z.infer<typeof importedOpencodeAgentMetadataSchema>;
export type ImportedOpencodeSkillMetadata = z.infer<typeof importedOpencodeSkillMetadataSchema>;
export type OpencodeProjectPlannedAgentUpsert = z.infer<typeof opencodeProjectPlannedAgentUpsertSchema>;
export type OpencodeProjectSyncPlanResult = z.infer<typeof opencodeProjectSyncPlanResultSchema>;
export type OpencodeProjectAppliedAgentResult = z.infer<typeof opencodeProjectAppliedAgentResultSchema>;
export type OpencodeProjectFinalizeSyncInput = z.infer<typeof opencodeProjectFinalizeSyncInputSchema>;

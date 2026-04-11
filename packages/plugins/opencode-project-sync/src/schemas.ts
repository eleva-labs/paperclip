import { z } from "@paperclipai/plugin-sdk";

export const opencodeProjectSourceOfTruthSchema = z.enum([
  "repo_first",
  "paperclip_export_guarded",
]);

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
});

export const opencodeProjectExportInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  exportAgents: z.boolean().default(true),
  exportSkills: z.boolean().default(false),
  forceIfRepoUnchangedCheckFails: z.boolean().default(false),
  skillDetails: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    markdown: z.string(),
  })).optional(),
});

export const opencodeProjectTestRuntimeInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  workspaceMode: z.enum(["canonical", "resolved_execution_workspace"]).default("canonical"),
});

export const opencodeProjectConflictSchema = z.object({
  code: z.enum([
    "ambiguous_repo_layout",
    "identity_collision",
    "paperclip_entity_drift",
    "repo_changed_since_last_import",
    "export_target_changed",
  ]),
  message: z.string().min(1),
  repoRelPath: z.string().min(1).nullable(),
  entityType: z.enum(["agent", "skill", "workspace"]).nullable(),
  entityKey: z.string().min(1).nullable(),
});

export const importedOpencodeAgentMetadataSchema = z.object({
  syncManaged: z.literal(true),
  sourceSystem: z.literal("opencode_project_repo"),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema,
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  repoRoot: z.string().min(1),
  repoRelPath: z.string().min(1),
  canonicalLocator: z.string().min(1),
  externalAgentKey: z.string().min(1),
  externalAgentName: z.string().min(1),
  folderPath: z.string().min(1).nullable(),
  hierarchyMode: z.enum(["reports_to", "metadata_only"]),
  reportsToExternalKey: z.string().min(1).nullable(),
  desiredSkillKeys: z.array(z.string().min(1)).default([]),
  lastImportedFingerprint: z.string().min(1).nullable(),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedFingerprint: z.string().min(1).nullable(),
  lastExportedAt: z.string().datetime().nullable(),
});

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

export const opencodeProjectPlannedSkillUpsertSchema = z.object({
  operation: z.enum(["create", "update"]),
  paperclipSkillId: z.string().uuid().nullable(),
  externalSkillKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
    slug: z.string().min(1),
    markdown: z.string(),
    filePath: z.string().min(1),
  }),
});

export const opencodeProjectPlannedAgentUpsertSchema = z.object({
  operation: z.enum(["create", "update"]),
  paperclipAgentId: z.string().uuid().nullable(),
  externalAgentKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  desiredSkillKeys: z.array(z.string().min(1)),
  payload: z.object({
    name: z.string().min(1),
    title: z.string().min(1).nullable(),
    reportsToExternalKey: z.string().min(1).nullable(),
    adapterType: z.string().min(1),
    adapterConfig: z.record(z.string(), z.unknown()),
    metadata: importedOpencodeAgentMetadataSchema,
  }),
});

export const opencodeProjectSyncPlanResultSchema = z.object({
  ok: z.literal(true),
  dryRun: z.boolean(),
  workspaceId: z.string().uuid(),
  importedAgentCount: z.number().int().nonnegative(),
  updatedAgentCount: z.number().int().nonnegative(),
  importedSkillCount: z.number().int().nonnegative(),
  updatedSkillCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  conflicts: z.array(opencodeProjectConflictSchema),
  lastScanFingerprint: z.string().min(1),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema,
  skillUpserts: z.array(opencodeProjectPlannedSkillUpsertSchema),
  agentUpserts: z.array(opencodeProjectPlannedAgentUpsertSchema),
});

export const opencodeProjectAppliedSkillResultSchema = z.object({
  externalSkillKey: z.string().min(1),
  paperclipSkillId: z.string().uuid(),
});

export const opencodeProjectAppliedAgentResultSchema = z.object({
  externalAgentKey: z.string().min(1),
  paperclipAgentId: z.string().uuid(),
});

export const opencodeProjectFinalizeSyncInputSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  importedAt: z.string().datetime(),
  lastScanFingerprint: z.string().min(1),
  warnings: z.array(z.string()),
  sourceOfTruth: opencodeProjectSourceOfTruthSchema,
  skillUpserts: z.array(opencodeProjectPlannedSkillUpsertSchema),
  agentUpserts: z.array(opencodeProjectPlannedAgentUpsertSchema),
  appliedSkills: z.array(opencodeProjectAppliedSkillResultSchema),
  appliedAgents: z.array(opencodeProjectAppliedAgentResultSchema),
});

export const opencodeProjectSyncManifestAgentSchema = z.object({
  paperclipAgentId: z.string().uuid(),
  externalAgentKey: z.string().min(1),
  repoRelPath: z.string().min(1),
  fingerprint: z.string().min(1),
  canonicalLocator: z.string().min(1).optional(),
  externalAgentName: z.string().min(1).optional(),
  lastImportedAt: z.string().datetime().nullable().optional(),
  lastExportedFingerprint: z.string().min(1).nullable().optional(),
  lastExportedAt: z.string().datetime().nullable().optional(),
});

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
export type OpencodeProjectResolveWorkspaceInput = z.infer<typeof opencodeProjectResolveWorkspaceInputSchema>;
export type OpencodeProjectSyncNowInput = z.infer<typeof opencodeProjectSyncNowInputSchema>;
export type OpencodeProjectExportInput = z.infer<typeof opencodeProjectExportInputSchema>;
export type OpencodeProjectTestRuntimeInput = z.infer<typeof opencodeProjectTestRuntimeInputSchema>;
export type OpencodeProjectSyncManifestAgent = z.infer<typeof opencodeProjectSyncManifestAgentSchema>;
export type OpencodeProjectSyncManifestSkill = z.infer<typeof opencodeProjectSyncManifestSkillSchema>;
export type OpencodeProjectConflict = z.infer<typeof opencodeProjectConflictSchema>;
export type ImportedOpencodeAgentMetadata = z.infer<typeof importedOpencodeAgentMetadataSchema>;
export type ImportedOpencodeSkillMetadata = z.infer<typeof importedOpencodeSkillMetadataSchema>;
export type OpencodeProjectPlannedSkillUpsert = z.infer<typeof opencodeProjectPlannedSkillUpsertSchema>;
export type OpencodeProjectPlannedAgentUpsert = z.infer<typeof opencodeProjectPlannedAgentUpsertSchema>;
export type OpencodeProjectSyncPlanResult = z.infer<typeof opencodeProjectSyncPlanResultSchema>;
export type OpencodeProjectAppliedSkillResult = z.infer<typeof opencodeProjectAppliedSkillResultSchema>;
export type OpencodeProjectAppliedAgentResult = z.infer<typeof opencodeProjectAppliedAgentResultSchema>;
export type OpencodeProjectFinalizeSyncInput = z.infer<typeof opencodeProjectFinalizeSyncInputSchema>;

import { z } from "zod";

export const OPENCODE_PROJECT_REPO_SOURCE_SYSTEM = "opencode_project_repo" as const;

export const opencodeProjectSourceOfTruthSchema = z.enum([
  "repo_first",
  "paperclip_export_guarded",
]);

export type OpencodeProjectSourceOfTruth = z.infer<typeof opencodeProjectSourceOfTruthSchema>;

export const importedOpencodeAgentMetadataSchema = z.object({
  syncManaged: z.literal(true),
  sourceSystem: z.literal(OPENCODE_PROJECT_REPO_SOURCE_SYSTEM),
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
  lastImportedFingerprint: z.string().min(1).nullable(),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedFingerprint: z.string().min(1).nullable(),
  lastExportedAt: z.string().datetime().nullable(),
});

export type ImportedOpencodeAgentMetadata = z.infer<typeof importedOpencodeAgentMetadataSchema>;

export const importedOpencodeSkillMetadataSchema = z.object({
  syncManaged: z.literal(true),
  sourceSystem: z.literal(OPENCODE_PROJECT_REPO_SOURCE_SYSTEM),
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

export type ImportedOpencodeSkillMetadata = z.infer<typeof importedOpencodeSkillMetadataSchema>;

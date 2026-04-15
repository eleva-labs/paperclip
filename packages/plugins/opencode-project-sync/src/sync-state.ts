import { z } from "@paperclipai/plugin-sdk";
import {
  opencodeProjectSyncPolicySchema,
  opencodeSelectedAgentSchema,
  opencodeProjectConflictSchema,
  opencodeProjectSyncManifestAgentSchema,
} from "./schemas.js";

export const OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND = "project_workspace" as const;
export const OPENCODE_PROJECT_SYNC_STATE_NAMESPACE = "opencode-project-sync";
export const OPENCODE_PROJECT_SYNC_STATE_KEY = "state";
export const OPENCODE_PROJECT_SYNC_LAST_PREVIEW_KEY = "last-preview";
export const OPENCODE_PROJECT_SYNC_MANIFEST_VERSION = 2 as const;

export const opencodeProjectRuntimeTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const opencodeProjectSyncStateSchema = z.object({
  projectId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  canonicalRepoRoot: z.string().min(1),
  canonicalRepoUrl: z.string().url().nullable(),
  canonicalRepoRef: z.string().min(1).nullable(),
  bootstrapCompletedAt: z.string().datetime().nullable(),
  lastScanFingerprint: z.string().min(1).nullable(),
  lastImportedAt: z.string().datetime().nullable(),
  lastExportedAt: z.string().datetime().nullable(),
  manifestVersion: z.literal(OPENCODE_PROJECT_SYNC_MANIFEST_VERSION),
  syncPolicy: opencodeProjectSyncPolicySchema,
  selectedAgents: z.array(opencodeSelectedAgentSchema),
  importedAgents: z.array(opencodeProjectSyncManifestAgentSchema),
  warnings: z.array(z.string()),
  conflicts: z.array(opencodeProjectConflictSchema),
}).strict();

export type OpencodeProjectSyncState = z.infer<typeof opencodeProjectSyncStateSchema>;

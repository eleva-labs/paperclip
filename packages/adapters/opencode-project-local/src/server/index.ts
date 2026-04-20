import type {
  AdapterConfigSchema,
  AdapterSessionCodec,
} from "@paperclipai/adapter-utils";
import { getOpencodeProjectLocalConfigSchema } from "./config-schema.js";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId =
      readNonEmptyString(record.sessionId) ??
      readNonEmptyString(record.session_id) ??
      readNonEmptyString(record.sessionID);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    const canonicalWorkspaceId =
      readNonEmptyString(record.canonicalWorkspaceId) ?? readNonEmptyString(record.canonical_workspace_id);
    const canonicalWorkspaceCwd =
      readNonEmptyString(record.canonicalWorkspaceCwd) ?? readNonEmptyString(record.canonical_workspace_cwd);
    const executionWorkspaceSource =
      readNonEmptyString(record.executionWorkspaceSource) ?? readNonEmptyString(record.execution_workspace_source);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
      ...(canonicalWorkspaceId ? { canonicalWorkspaceId } : {}),
      ...(canonicalWorkspaceCwd ? { canonicalWorkspaceCwd } : {}),
      ...(executionWorkspaceSource ? { executionWorkspaceSource } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId =
      readNonEmptyString(params.sessionId) ??
      readNonEmptyString(params.session_id) ??
      readNonEmptyString(params.sessionID);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(params.cwd) ??
      readNonEmptyString(params.workdir) ??
      readNonEmptyString(params.folder);
    const workspaceId = readNonEmptyString(params.workspaceId) ?? readNonEmptyString(params.workspace_id);
    const repoUrl = readNonEmptyString(params.repoUrl) ?? readNonEmptyString(params.repo_url);
    const repoRef = readNonEmptyString(params.repoRef) ?? readNonEmptyString(params.repo_ref);
    const canonicalWorkspaceId =
      readNonEmptyString(params.canonicalWorkspaceId) ?? readNonEmptyString(params.canonical_workspace_id);
    const canonicalWorkspaceCwd =
      readNonEmptyString(params.canonicalWorkspaceCwd) ?? readNonEmptyString(params.canonical_workspace_cwd);
    const executionWorkspaceSource =
      readNonEmptyString(params.executionWorkspaceSource) ?? readNonEmptyString(params.execution_workspace_source);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
      ...(canonicalWorkspaceId ? { canonicalWorkspaceId } : {}),
      ...(canonicalWorkspaceCwd ? { canonicalWorkspaceCwd } : {}),
      ...(executionWorkspaceSource ? { executionWorkspaceSource } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return (
      readNonEmptyString(params.sessionId) ??
      readNonEmptyString(params.session_id) ??
      readNonEmptyString(params.sessionID)
    );
  },
};

export function getConfigSchema(): AdapterConfigSchema {
  return getOpencodeProjectLocalConfigSchema();
}

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { listProjectAwareOpenCodeModels } from "./models.js";

export {
  getOpencodeProjectLocalConfigSchema,
  opencodeProjectLocalConfigSchema,
  type OpencodeProjectLocalConfig,
} from "./config-schema.js";
export {
  OPENCODE_PROJECT_REPO_SOURCE_SYSTEM,
  importedOpencodeAgentMetadataSchema,
  importedOpencodeSkillMetadataSchema,
  opencodeProjectSourceOfTruthSchema,
  type ImportedOpencodeAgentMetadata,
  type ImportedOpencodeSkillMetadata,
  type OpencodeProjectSourceOfTruth,
} from "./metadata.js";
export {
  resolveProjectExecutionContext,
  type ResolveProjectExecutionContextInput,
  type ResolveProjectExecutionContextResult,
} from "./execute.js";
export {
  discoverProjectAwareOpenCodeModels,
  ensureProjectAwareOpenCodeModelConfiguredAndAvailable,
  resetProjectAwareOpenCodeModelsCacheForTests,
} from "./models.js";
export { prepareProjectAwareOpenCodeRuntimeConfig } from "./runtime-config.js";

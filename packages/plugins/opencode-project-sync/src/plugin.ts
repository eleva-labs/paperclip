import * as fs from "node:fs";
import * as path from "node:path";
import { definePlugin } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import {
  opencodeProjectHostMutationContract,
  opencodeProjectHostMutationContractSchema,
} from "./host-contract.js";
import {
  OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
  OPENCODE_PROJECT_EXPORT_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_HOST_CONTRACT_DATA_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_PLUGIN_ID,
  OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY,
  OPENCODE_PROJECT_SYNC_STATE_DATA_KEY,
  OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY,
} from "./manifest.js";
import {
  discoverOpencodeProjectFiles,
  type DiscoveredOpencodeProjectFiles,
} from "./discovery.js";
import {
  buildImportPlan,
  type MinimalPaperclipAgent,
} from "./import-plan.js";
import { writeGuardedAgentExportFile } from "./export-write-guard.js";
import { buildExportPlan, validateExportRepoRelPath } from "./export-plan.js";
import {
  opencodeProjectFinalizeSyncInputSchema,
  opencodeProjectExportInputSchema,
  opencodeProjectResolveWorkspaceInputSchema,
  opencodeProjectSyncPlanResultSchema,
  opencodeProjectSyncNowInputSchema,
  opencodeProjectTestRuntimeInputSchema,
  type OpencodeProjectAppliedAgentResult,
  type OpencodeProjectConflict,
  type OpencodeProjectSyncManifestAgent,
} from "./schemas.js";
import {
  OPENCODE_PROJECT_SYNC_MANIFEST_VERSION,
  OPENCODE_PROJECT_SYNC_STATE_KEY,
  OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
  OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
  opencodeProjectSyncStateSchema,
  type OpencodeProjectSyncState,
} from "./sync-state.js";

type ResolvedCanonicalWorkspace = {
  projectId: string;
  workspaceId: string;
  cwd: string;
  repoUrl: string | null;
  repoRef: string | null;
};

type SyncActionResult = {
  ok: true;
  dryRun: boolean;
  workspaceId: string;
  importedAgentCount: number;
  updatedAgentCount: number;
  importedSkillCount: number;
  updatedSkillCount: number;
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
  lastScanFingerprint: string;
};

type ExportActionResult = {
  ok: true;
  workspaceId: string;
  writtenFiles: string[];
  warnings: string[];
  conflicts: OpencodeProjectConflict[];
};

function isLoggedPluginError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "__opencodeProjectLogged" in error
    && (error as { __opencodeProjectLogged?: boolean }).__opencodeProjectLogged === true,
  );
}

function getStateScope(workspaceId: string) {
  return {
    scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
    scopeId: workspaceId,
    namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
    stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY,
  } as const;
}

function getPreviewScope(workspaceId: string) {
  return {
    scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
    scopeId: workspaceId,
    namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
    stateKey: "last-preview",
  } as const;
}

function unreachable(message: string): never {
  throw new Error(message);
}

function isRepoCheckout(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, ".git"));
}

async function resolveCanonicalProjectWorkspace(
  ctx: PluginContext,
  input: { companyId: string; projectId: string },
): Promise<ResolvedCanonicalWorkspace> {
  const project = await ctx.projects.get(input.projectId, input.companyId);
  if (!project) {
    throw new Error(`Project '${input.projectId}' is not visible to the plugin for company '${input.companyId}'.`);
  }

  const primaryWorkspace = project.primaryWorkspace ?? project.workspaces.find((workspace: typeof project.workspaces[number]) => workspace.isPrimary) ?? null;
  if (!primaryWorkspace) {
    throw new Error("This project has no primary workspace. Attach a canonical project workspace before bootstrapping sync.");
  }

  const cwd = typeof primaryWorkspace.cwd === "string" && primaryWorkspace.cwd.trim().length > 0
    ? primaryWorkspace.cwd.trim()
    : null;
  if (!cwd) {
    throw new Error("The primary project workspace has no local checkout path. Prepare the workspace locally before importing or exporting.");
  }
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`The canonical workspace path does not exist on disk: ${cwd}. Re-run workspace setup before importing or exporting.`);
  }

  const repoUrl = typeof primaryWorkspace.repoUrl === "string" && primaryWorkspace.repoUrl.trim().length > 0
    ? primaryWorkspace.repoUrl.trim()
    : null;
  if (!repoUrl && !isRepoCheckout(cwd)) {
    throw new Error(
      "The primary project workspace is missing repo binding metadata and no local git checkout was found. Bind the workspace to a repo or prepare a local checkout before importing or exporting.",
    );
  }

  return {
    projectId: input.projectId,
    workspaceId: primaryWorkspace.id,
    cwd,
    repoUrl,
    repoRef: primaryWorkspace.repoRef ?? null,
  };
}

async function readValidatedSyncState(
  ctx: PluginContext,
  workspaceId: string,
): Promise<OpencodeProjectSyncState | null> {
  const raw = await ctx.state.get(getStateScope(workspaceId));
  if (raw === null) return null;
  const parsed = opencodeProjectSyncStateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "Stored OpenCode project sync state is invalid. Clear the plugin state for this workspace and bootstrap again before retrying.",
    );
  }
  return parsed.data;
}

async function readOrCreateSyncState(
  ctx: PluginContext,
  resolvedWorkspace: ResolvedCanonicalWorkspace,
): Promise<OpencodeProjectSyncState> {
  const existing = await readValidatedSyncState(ctx, resolvedWorkspace.workspaceId);
  if (existing) return existing;
  return {
    projectId: resolvedWorkspace.projectId,
    workspaceId: resolvedWorkspace.workspaceId,
    bootstrapCompletedAt: null,
    canonicalRepoRoot: resolvedWorkspace.cwd,
    canonicalRepoUrl: resolvedWorkspace.repoUrl,
    canonicalRepoRef: resolvedWorkspace.repoRef,
    lastScanFingerprint: null,
    lastImportedAt: null,
    lastExportedAt: null,
    manifestVersion: OPENCODE_PROJECT_SYNC_MANIFEST_VERSION,
    syncPolicy: {
      mode: "top_level_agents_only",
      syncSkills: false,
      importRootAgentsMd: false,
      importNestedAgents: false,
    },
    selectedAgents: [],
    importedAgents: [],
    warnings: [],
    conflicts: [],
  };
}

async function logProjectActivity(
  ctx: PluginContext,
  input: {
    companyId: string;
    projectId: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.activity.log({
    companyId: input.companyId,
    entityType: "project",
    entityId: input.projectId,
    message: input.message,
    metadata: {
      pluginId: OPENCODE_PROJECT_SYNC_PLUGIN_ID,
      ...(input.metadata ?? {}),
    },
  });
}

async function logFailureAndThrow(
  ctx: PluginContext,
  input: {
    companyId: string;
    projectId: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<never> {
  await logProjectActivity(ctx, input);
  const error = new Error(input.message) as Error & { __opencodeProjectLogged?: boolean };
  error.__opencodeProjectLogged = true;
  throw error;
}


function toMinimalAgent(agent: {
  id: string;
  name: string;
  title: string | null;
  reportsTo: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
}): MinimalPaperclipAgent {
  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    reportsTo: agent.reportsTo,
    adapterType: agent.adapterType,
    adapterConfig: agent.adapterConfig,
    metadata: agent.metadata,
  };
}

function previewFromDiscovery(discovery: DiscoveredOpencodeProjectFiles) {
  return {
    lastScanFingerprint: discovery.lastScanFingerprint,
    eligibleAgents: discovery.eligibleAgents.map((agent) => ({
      externalAgentKey: agent.externalAgentKey,
      displayName: agent.displayName,
      repoRelPath: agent.repoRelPath,
      fingerprint: agent.fingerprint,
      role: agent.role,
      advisoryMode: agent.advisoryMode,
      selectionDefault: agent.selectionDefault,
      frontmatter: agent.frontmatter,
    })),
    ineligibleNestedAgents: discovery.ineligibleNestedAgents,
    ignoredArtifacts: discovery.ignoredArtifacts,
    warnings: discovery.warnings.map((warning) => warning.message),
  };
}

function reconcileSelectedAgents(
  selectedAgentKeys: string[],
  discovery: DiscoveredOpencodeProjectFiles,
  selectedAt: string,
): OpencodeProjectSyncState["selectedAgents"] {
  const eligibleByKey = new Map(
    discovery.eligibleAgents.map((agent) => [agent.externalAgentKey, agent] as const),
  );
  return selectedAgentKeys.flatMap((externalAgentKey) => {
    const agent = eligibleByKey.get(externalAgentKey);
    if (!agent) return [];
    return [{
      externalAgentKey,
      repoRelPath: agent.repoRelPath,
      fingerprint: agent.fingerprint,
      selectedAt,
    }];
  });
}

function selectedImportedAgentsFromFinalizeInput(
  input: ReturnType<typeof opencodeProjectFinalizeSyncInputSchema.parse>,
  resolvedWorkspace: ResolvedCanonicalWorkspace,
  discovery: DiscoveredOpencodeProjectFiles,
  previousState: OpencodeProjectSyncState,
): OpencodeProjectSyncState["importedAgents"] {
  const selectedAgents = reconcileSelectedAgents(input.selectedAgentKeys, discovery, input.importedAt);
  const selectedByKey = new Map<string, OpencodeProjectSyncState["selectedAgents"][number]>(
    selectedAgents.map((agent: OpencodeProjectSyncState["selectedAgents"][number]) => [agent.externalAgentKey, agent] as const),
  );
  const eligibleByKey = new Map<string, DiscoveredOpencodeProjectFiles["eligibleAgents"][number]>(
    discovery.eligibleAgents.map((agent: DiscoveredOpencodeProjectFiles["eligibleAgents"][number]) => [agent.externalAgentKey, agent] as const),
  );
  const agentIdByExternalKey = new Map<string, string>(
    input.appliedAgents.map((entry: OpencodeProjectAppliedAgentResult) => [entry.externalAgentKey, entry.paperclipAgentId] as const),
  );

  return input.agentUpserts.flatMap((entry: typeof input.agentUpserts[number]) => {
    const selected = selectedByKey.get(entry.externalAgentKey);
    const eligible = eligibleByKey.get(entry.externalAgentKey);
    if (!selected || !eligible) {
      return [];
    }

    if (selected.repoRelPath !== entry.repoRelPath || selected.fingerprint !== entry.fingerprint) {
      return [];
    }

    const paperclipAgentId = agentIdByExternalKey.get(entry.externalAgentKey);
    if (!paperclipAgentId) {
      return [];
    }

    const previousImported = previousState.importedAgents.find(
      (agent: OpencodeProjectSyncManifestAgent) => agent.externalAgentKey === entry.externalAgentKey,
    );

    return [{
      paperclipAgentId,
      externalAgentKey: entry.externalAgentKey,
      repoRelPath: entry.repoRelPath,
      fingerprint: entry.fingerprint,
      canonicalLocator: `${resolvedWorkspace.cwd}::${entry.repoRelPath}`,
      externalAgentName: eligible.displayName,
      lastImportedAt: input.importedAt,
      lastExportedFingerprint: previousImported?.lastExportedFingerprint ?? null,
      lastExportedAt: previousImported?.lastExportedAt ?? null,
    }];
  });
}

async function bootstrapProject(
  ctx: PluginContext,
  input: { companyId: string; projectId: string },
): Promise<SyncActionResult> {
  const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, input);
  const previousState = await readOrCreateSyncState(ctx, resolvedWorkspace);
  const discovery = discoverOpencodeProjectFiles({ repoRoot: resolvedWorkspace.cwd });
  const now = new Date().toISOString();
  const nextState: OpencodeProjectSyncState = opencodeProjectSyncStateSchema.parse({
    ...previousState,
    bootstrapCompletedAt: now,
    canonicalRepoRoot: resolvedWorkspace.cwd,
    canonicalRepoUrl: resolvedWorkspace.repoUrl,
    canonicalRepoRef: resolvedWorkspace.repoRef,
    lastScanFingerprint: discovery.lastScanFingerprint,
    warnings: discovery.warnings.map((warning) => warning.message),
    conflicts: previousState.conflicts,
  });
  await ctx.state.set(getStateScope(resolvedWorkspace.workspaceId), nextState);
  await ctx.state.set(getPreviewScope(resolvedWorkspace.workspaceId), previewFromDiscovery(discovery));
  await logProjectActivity(ctx, {
    companyId: input.companyId,
    projectId: input.projectId,
      message: "OpenCode project workspace bootstrap completed",
      metadata: {
        workspaceId: resolvedWorkspace.workspaceId,
        discoveredEligibleAgentCount: discovery.eligibleAgents.length,
        discoveredNestedAgentCount: discovery.ineligibleNestedAgents.length,
        ignoredArtifactCount: discovery.ignoredArtifacts.length,
      },
    });
  return {
    ok: true,
    dryRun: false,
    workspaceId: resolvedWorkspace.workspaceId,
    importedAgentCount: 0,
    updatedAgentCount: 0,
    importedSkillCount: 0,
    updatedSkillCount: 0,
    warnings: nextState.warnings,
    conflicts: nextState.conflicts,
    lastScanFingerprint: discovery.lastScanFingerprint,
  };
}

async function syncProject(
  ctx: PluginContext,
  input: ReturnType<typeof opencodeProjectSyncNowInputSchema.parse>,
): Promise<SyncActionResult> {
  const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, input);
  if (input.workspaceId && input.workspaceId !== resolvedWorkspace.workspaceId) {
    await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: `Requested workspace '${input.workspaceId}' does not match the canonical primary workspace '${resolvedWorkspace.workspaceId}'. Phase-1 sync only supports the canonical workspace.`,
      metadata: { requestedWorkspaceId: input.workspaceId, canonicalWorkspaceId: resolvedWorkspace.workspaceId },
    });
  }

  const previousState = await readOrCreateSyncState(ctx, resolvedWorkspace);
  const discovery = discoverOpencodeProjectFiles({ repoRoot: resolvedWorkspace.cwd });
  const existingAgents = (await ctx.agents.list({ companyId: input.companyId })).map(toMinimalAgent);
  const importedAt = new Date().toISOString();
  const plan = buildImportPlan({
    companyId: input.companyId,
    projectId: input.projectId,
    workspaceId: resolvedWorkspace.workspaceId,
    repoRoot: resolvedWorkspace.cwd,
    sourceOfTruth: "repo_first",
    discovery,
    selectedAgentKeys: input.selectedAgentKeys,
    existingState: previousState,
    existingAgents,
    importedAt,
  });

  if (plan.conflicts.length > 0) {
    const nextState = opencodeProjectSyncStateSchema.parse({
      ...previousState,
      canonicalRepoRoot: resolvedWorkspace.cwd,
      canonicalRepoUrl: resolvedWorkspace.repoUrl,
      canonicalRepoRef: resolvedWorkspace.repoRef,
      lastScanFingerprint: discovery.lastScanFingerprint,
      warnings: plan.warnings,
      conflicts: plan.conflicts,
      selectedAgents: reconcileSelectedAgents(input.selectedAgentKeys, discovery, importedAt),
    });
    await ctx.state.set(getStateScope(resolvedWorkspace.workspaceId), nextState);
    await ctx.state.set(getPreviewScope(resolvedWorkspace.workspaceId), previewFromDiscovery(discovery));
    await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: `OpenCode import blocked: ${plan.conflicts.map((conflict) => conflict.message).join("; ")}`,
      metadata: { workspaceId: resolvedWorkspace.workspaceId, conflicts: plan.conflicts },
    });
  }

  await ctx.state.set(getPreviewScope(resolvedWorkspace.workspaceId), previewFromDiscovery(discovery));

  return opencodeProjectSyncPlanResultSchema.parse({
    ok: true,
    dryRun: input.dryRun,
    workspaceId: resolvedWorkspace.workspaceId,
    importedAgentCount: plan.agentUpserts.filter((entry) => entry.operation === "create").length,
    updatedAgentCount: plan.agentUpserts.filter((entry) => entry.operation === "update").length,
    importedSkillCount: 0,
    updatedSkillCount: 0,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    lastScanFingerprint: discovery.lastScanFingerprint,
    sourceOfTruth: plan.sourceOfTruth,
    preview: previewFromDiscovery(discovery),
    skillUpserts: plan.skillUpserts,
    agentUpserts: plan.agentUpserts,
  });
}

async function finalizeSyncProject(
  ctx: PluginContext,
  input: ReturnType<typeof opencodeProjectFinalizeSyncInputSchema.parse>,
): Promise<SyncActionResult> {
  const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, input);
  if (input.workspaceId && input.workspaceId !== resolvedWorkspace.workspaceId) {
    await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: `Requested workspace '${input.workspaceId}' does not match the canonical primary workspace '${resolvedWorkspace.workspaceId}'. Phase-1 sync only supports the canonical workspace.`,
      metadata: { requestedWorkspaceId: input.workspaceId, canonicalWorkspaceId: resolvedWorkspace.workspaceId },
    });
  }

  const previousState = await readOrCreateSyncState(ctx, resolvedWorkspace);
  const discovery = discoverOpencodeProjectFiles({ repoRoot: resolvedWorkspace.cwd });
  const selectedAgents = reconcileSelectedAgents(input.selectedAgentKeys, discovery, input.importedAt);
  const selectedByKey = new Set(selectedAgents.map((agent: OpencodeProjectSyncState["selectedAgents"][number]) => agent.externalAgentKey));
  const eligibleByKey = new Map<string, DiscoveredOpencodeProjectFiles["eligibleAgents"][number]>(
    discovery.eligibleAgents.map((agent: DiscoveredOpencodeProjectFiles["eligibleAgents"][number]) => [agent.externalAgentKey, agent] as const),
  );
  const agentIdByExternalKey = new Map(input.appliedAgents.map((entry: OpencodeProjectAppliedAgentResult) => [entry.externalAgentKey, entry.paperclipAgentId] as const));

  for (const upsert of input.agentUpserts) {
    const selected = selectedByKey.has(upsert.externalAgentKey);
    if (!selected) {
      await logFailureAndThrow(ctx, {
        companyId: input.companyId,
        projectId: input.projectId,
        message: `Finalize payload included agent '${upsert.externalAgentKey}' outside the selected eligible top-level set. Refresh discovery and retry the selected import.`,
        metadata: { workspaceId: resolvedWorkspace.workspaceId, externalAgentKey: upsert.externalAgentKey },
      });
    }
    const currentEligible = eligibleByKey.get(upsert.externalAgentKey) ?? await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: `Finalize payload included agent '${upsert.externalAgentKey}' outside the selected eligible top-level set. Refresh discovery and retry the selected import.`,
      metadata: { workspaceId: resolvedWorkspace.workspaceId, externalAgentKey: upsert.externalAgentKey },
    });
    if (currentEligible.repoRelPath !== upsert.repoRelPath || currentEligible.fingerprint !== upsert.fingerprint) {
      await logFailureAndThrow(ctx, {
        companyId: input.companyId,
        projectId: input.projectId,
        message: `Finalize payload for '${upsert.externalAgentKey}' no longer matches the current eligible top-level discovery state. Refresh discovery before finalizing import.`,
        metadata: { workspaceId: resolvedWorkspace.workspaceId, externalAgentKey: upsert.externalAgentKey },
      });
    }
    if (!agentIdByExternalKey.get(upsert.externalAgentKey)) {
      await logFailureAndThrow(ctx, {
        companyId: input.companyId,
        projectId: input.projectId,
        message: `Agent '${upsert.externalAgentKey}' could not be mapped to a Paperclip agent id during sync finalization.`,
        metadata: { workspaceId: resolvedWorkspace.workspaceId },
      });
    }
  }

  const nextState = opencodeProjectSyncStateSchema.parse({
    ...previousState,
    bootstrapCompletedAt: previousState.bootstrapCompletedAt ?? input.importedAt,
    canonicalRepoRoot: resolvedWorkspace.cwd,
    canonicalRepoUrl: resolvedWorkspace.repoUrl,
    canonicalRepoRef: resolvedWorkspace.repoRef,
    lastScanFingerprint: input.lastScanFingerprint,
    lastImportedAt: input.importedAt,
    importedAgents: selectedImportedAgentsFromFinalizeInput(input, resolvedWorkspace, discovery, previousState),
    selectedAgents,
    warnings: input.warnings,
    conflicts: [],
  });

  await ctx.state.set(getStateScope(resolvedWorkspace.workspaceId), nextState);
  await ctx.state.set(getPreviewScope(resolvedWorkspace.workspaceId), previewFromDiscovery(discovery));
  await logProjectActivity(ctx, {
    companyId: input.companyId,
    projectId: input.projectId,
    message: "OpenCode import sync completed",
    metadata: {
      workspaceId: resolvedWorkspace.workspaceId,
      importedAgentCount: input.agentUpserts.filter((entry: typeof input.agentUpserts[number]) => entry.operation === "create").length,
      updatedAgentCount: input.agentUpserts.filter((entry: typeof input.agentUpserts[number]) => entry.operation === "update").length,
      importedSkillCount: 0,
      updatedSkillCount: 0,
    },
  });

  return {
    ok: true,
    dryRun: false,
    workspaceId: resolvedWorkspace.workspaceId,
    importedAgentCount: input.agentUpserts.filter((entry: typeof input.agentUpserts[number]) => entry.operation === "create").length,
    updatedAgentCount: input.agentUpserts.filter((entry: typeof input.agentUpserts[number]) => entry.operation === "update").length,
    importedSkillCount: 0,
    updatedSkillCount: 0,
    warnings: input.warnings,
    conflicts: [],
    lastScanFingerprint: input.lastScanFingerprint,
  };
}

async function exportProject(
  ctx: PluginContext,
  input: ReturnType<typeof opencodeProjectExportInputSchema.parse>,
): Promise<ExportActionResult> {
  const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, input);
  const state = await readValidatedSyncState(ctx, resolvedWorkspace.workspaceId);
  if (state === null) {
    await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: "OpenCode export is blocked because this project workspace has not been imported yet.",
      metadata: { workspaceId: resolvedWorkspace.workspaceId },
    });
  }
  const syncState = state ?? unreachable("Expected sync state after export precondition failure handling.");

  const discovery = discoverOpencodeProjectFiles({ repoRoot: resolvedWorkspace.cwd });
  const agents = (await ctx.agents.list({ companyId: input.companyId }))
    .filter((agent: Awaited<ReturnType<PluginContext["agents"]["list"]>>[number]) => (
      syncState.importedAgents.some((entry: OpencodeProjectSyncManifestAgent) => entry.paperclipAgentId === agent.id)
    ))
    .map((agent: Awaited<ReturnType<PluginContext["agents"]["list"]>>[number]) => ({
      id: agent.id,
      name: agent.name,
      title: agent.title,
      reportsTo: agent.reportsTo,
      adapterConfig: agent.adapterConfig,
      metadata: agent.metadata,
    }));

  const plan = buildExportPlan({
    state: syncState,
    repoRoot: resolvedWorkspace.cwd,
    currentRepoFingerprint: discovery.lastScanFingerprint,
    forceIfRepoUnchangedCheckFails: input.forceIfRepoUnchangedCheckFails,
    exportAgents: input.exportAgents,
    agents,
  });

  if (plan.blocked) {
    const nextState = opencodeProjectSyncStateSchema.parse({
      ...syncState,
      warnings: plan.warnings,
      conflicts: plan.conflicts,
    });
    await ctx.state.set(getStateScope(resolvedWorkspace.workspaceId), nextState);
    await logFailureAndThrow(ctx, {
      companyId: input.companyId,
      projectId: input.projectId,
      message: `OpenCode export blocked: ${plan.conflicts.map((conflict) => conflict.message).join("; ")}`,
      metadata: { workspaceId: resolvedWorkspace.workspaceId, conflicts: plan.conflicts },
    });
  }

  const writtenFiles: string[] = [];
  const exportedAt = new Date().toISOString();
  for (const file of plan.files) {
    const validatedTarget = validateExportRepoRelPath(file.entityType, file.repoRelPath);
    if (!validatedTarget.ok) {
      await logFailureAndThrow(ctx, {
        companyId: input.companyId,
        projectId: input.projectId,
        message: validatedTarget.message,
        metadata: { workspaceId: resolvedWorkspace.workspaceId, entityType: file.entityType, repoRelPath: file.repoRelPath },
      });
    }

    if (!validatedTarget.ok) {
      continue;
    }

    const repoRelPath = validatedTarget.repoRelPath;

    try {
      writeGuardedAgentExportFile(
        resolvedWorkspace.cwd,
        repoRelPath,
        file.sourceFingerprint,
        file.nextContent,
      );
    } catch (error) {
      await logFailureAndThrow(ctx, {
        companyId: input.companyId,
        projectId: input.projectId,
        message: error instanceof Error ? error.message : String(error),
        metadata: { workspaceId: resolvedWorkspace.workspaceId, entityType: file.entityType, repoRelPath },
      });
    }

    writtenFiles.push(repoRelPath);
  }

  const nextImportedAgents = syncState.importedAgents.map((entry: OpencodeProjectSyncManifestAgent) => {
    const exportedFile = plan.files.find((file) => file.entityType === "agent" && file.entityId === entry.paperclipAgentId);
    if (!exportedFile) return entry;
    return {
      ...entry,
      lastExportedFingerprint: exportedFile.fingerprint,
      lastExportedAt: exportedAt,
    };
  });

  const nextState = opencodeProjectSyncStateSchema.parse({
    ...syncState,
    warnings: plan.warnings,
    conflicts: [],
    lastExportedAt: exportedAt,
    importedAgents: nextImportedAgents,
  });
  await ctx.state.set(getStateScope(resolvedWorkspace.workspaceId), nextState);
  await logProjectActivity(ctx, {
    companyId: input.companyId,
    projectId: input.projectId,
    message: "OpenCode export completed",
    metadata: {
      workspaceId: resolvedWorkspace.workspaceId,
      writtenFiles,
    },
  });

  return {
    ok: true,
    workspaceId: resolvedWorkspace.workspaceId,
    writtenFiles,
    warnings: plan.warnings,
    conflicts: [],
  };
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    ctx.data.register(OPENCODE_PROJECT_SYNC_STATE_DATA_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectResolveWorkspaceInputSchema.parse(params);
      const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, parsed);
      const state = await readOrCreateSyncState(ctx, resolvedWorkspace);
      return {
        pluginId: OPENCODE_PROJECT_SYNC_PLUGIN_ID,
        scopeKind: OPENCODE_PROJECT_SYNC_STATE_SCOPE_KIND,
        namespace: OPENCODE_PROJECT_SYNC_STATE_NAMESPACE,
        stateKey: OPENCODE_PROJECT_SYNC_STATE_KEY,
        manifestVersion: OPENCODE_PROJECT_SYNC_MANIFEST_VERSION,
        workspace: resolvedWorkspace,
        state,
      };
    });

    ctx.data.register(OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectResolveWorkspaceInputSchema.parse(params);
      const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, parsed);
      const discovery = discoverOpencodeProjectFiles({ repoRoot: resolvedWorkspace.cwd });
      const state = await readOrCreateSyncState(ctx, resolvedWorkspace);
      return {
        workspace: resolvedWorkspace,
        state,
        preview: previewFromDiscovery(discovery),
      };
    });

    ctx.data.register(OPENCODE_PROJECT_SYNC_HOST_CONTRACT_DATA_KEY, async () => {
      return opencodeProjectHostMutationContractSchema.parse(opencodeProjectHostMutationContract);
    });

    ctx.actions.register(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectSyncNowInputSchema.parse({ ...params, mode: "bootstrap", dryRun: false });
      try {
        return await bootstrapProject(ctx, parsed);
      } catch (error) {
        if (isLoggedPluginError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await logFailureAndThrow(ctx, {
          companyId: parsed.companyId,
          projectId: parsed.projectId,
          message,
          metadata: { phase: "bootstrap" },
        });
      }
    });

    ctx.actions.register(OPENCODE_PROJECT_SYNC_ACTION_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectSyncNowInputSchema.parse(params);
      try {
        return await syncProject(ctx, parsed);
      } catch (error) {
        if (isLoggedPluginError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await logFailureAndThrow(ctx, {
          companyId: parsed.companyId,
          projectId: parsed.projectId,
          message,
          metadata: { phase: parsed.mode, dryRun: parsed.dryRun },
        });
      }
    });

    ctx.actions.register(OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectFinalizeSyncInputSchema.parse(params);
      try {
        return await finalizeSyncProject(ctx, parsed);
      } catch (error) {
        if (isLoggedPluginError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await logFailureAndThrow(ctx, {
          companyId: parsed.companyId,
          projectId: parsed.projectId,
          message,
          metadata: { phase: "finalize-sync" },
        });
      }
    });

    ctx.actions.register(OPENCODE_PROJECT_EXPORT_ACTION_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectExportInputSchema.parse(params);
      try {
        return await exportProject(ctx, parsed);
      } catch (error) {
        if (isLoggedPluginError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await logFailureAndThrow(ctx, {
          companyId: parsed.companyId,
          projectId: parsed.projectId,
          message,
          metadata: { phase: "export" },
        });
      }
    });

    ctx.actions.register(OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY, async (params: Record<string, unknown>) => {
      const parsed = opencodeProjectTestRuntimeInputSchema.parse(params);
      const resolvedWorkspace = await resolveCanonicalProjectWorkspace(ctx, parsed);
      const state = await readOrCreateSyncState(ctx, resolvedWorkspace);
      const result = {
        ok: false,
        message: "Adapter-backed runtime probing is not wired through this plugin action yet, so no runtime test was executed.",
        details: {
          availability: "unavailable",
          workspaceId: resolvedWorkspace.workspaceId,
          cwd: resolvedWorkspace.cwd,
          agentId: parsed.agentId,
          workspaceMode: parsed.workspaceMode,
        },
      };

      return result;
    });
  },

  async onHealth() {
    return {
      status: "ok",
      message: "OpenCode project sync worker loaded",
    };
  },
});

export default plugin;

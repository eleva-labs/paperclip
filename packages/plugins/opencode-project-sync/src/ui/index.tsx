import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL } from "@paperclipai/shared";
import {
  useHostContext,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginBridgeError,
} from "@paperclipai/plugin-sdk/ui";
import {
  OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
  OPENCODE_PROJECT_EXPORT_ACTION_KEY,
  OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY,
  OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID,
  OPENCODE_PROJECT_SYNC_PLUGIN_ID,
  OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY,
  OPENCODE_PROJECT_SYNC_STATE_DATA_KEY,
  OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY,
} from "../manifest.js";
import { OPENCODE_PROJECT_HOST_API_BASE_PATH } from "../host-contract-constants.js";

type Conflict = {
  code: string;
  message: string;
  repoRelPath: string | null;
  entityType: string | null;
  entityKey: string | null;
};

type SyncManifestAgent = {
  paperclipAgentId: string;
  externalAgentKey: string;
  repoRelPath: string;
  externalAgentName?: string | null;
};

type SyncManifestSkill = {
  paperclipSkillId: string;
  externalSkillKey: string;
  repoRelPath: string;
  externalSkillName?: string | null;
};

type SyncState = {
  sourceOfTruth: "repo_first" | "paperclip_export_guarded";
  bootstrapCompletedAt: string | null;
  canonicalRepoRoot: string;
  canonicalRepoUrl: string | null;
  canonicalRepoRef: string | null;
  lastScanFingerprint: string | null;
  lastImportedAt: string | null;
  lastExportedAt: string | null;
  lastRuntimeTestAt: string | null;
  lastRuntimeTestResult?: RuntimeTestResult | null;
  selectedAgents?: Array<{
    externalAgentKey: string;
    repoRelPath: string;
    fingerprint: string;
    selectedAt: string;
  }>;
  warnings: string[];
  conflicts: Conflict[];
  importedAgents: SyncManifestAgent[];
  importedSkills: SyncManifestSkill[];
  remoteLink?: {
    status: "not_linked" | "linked" | "stale" | "broken";
    baseUrl: string;
    linkedDirectoryHint: string;
    invalidReason: string | null;
    propagatedToImportedAgentsAt: string | null;
  } | null;
};

type WorkspaceBinding = {
  projectId: string;
  workspaceId: string;
  cwd: string;
  repoUrl: string | null;
  repoRef: string | null;
};

type StateData = {
  workspace: WorkspaceBinding;
  state: SyncState;
};

type PreviewData = {
  preview: {
    warnings: string[];
    lastScanFingerprint: string;
    eligibleAgents: Array<{
      externalAgentKey: string;
      displayName: string;
      repoRelPath: string;
      fingerprint: string;
      role: string | null;
      advisoryMode: "primary" | "subagent" | null;
      selectionDefault: boolean;
      frontmatter?: {
        model: string | null;
      };
    }>;
    ineligibleNestedAgents: Array<{
      externalAgentKey: string;
      displayName: string;
      repoRelPath: string;
    }>;
    ignoredArtifacts: Array<{
      kind: "skill" | "root_agents_md" | "other";
      repoRelPath: string;
    }>;
  };
};

type RemoteModeStatusData = {
  canonicalWorkspaceId: string;
  canonicalRepoRoot: string;
  companyBaseUrlDefault: string | null;
  remoteLink: SyncState["remoteLink"];
  syncAllowed: boolean;
  syncBlockReason: string | null;
};

type RuntimeTestResult = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

type PluginConfigResponse = {
  configJson?: Record<string, unknown> | null;
} | null;

type ActionNoticeTone = "success" | "warning" | "error";

type SyncActionResult = {
  importedAgentCount?: number;
  updatedAgentCount?: number;
  importedSkillCount?: number;
  updatedSkillCount?: number;
  warnings?: string[];
};

type SyncPlanResult = SyncActionResult & {
  ok: true;
  dryRun: boolean;
  workspaceId: string;
  lastScanFingerprint: string;
  sourceOfTruth: "repo_first" | "paperclip_export_guarded";
  skillUpserts: [];
  agentUpserts: Array<{
    operation: "create" | "update";
    paperclipAgentId: string | null;
    externalAgentKey: string;
    payload: {
      name: string;
      title: string | null;
      reportsTo: null;
      adapterType: string;
      adapterConfig: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
  }>;
};

type ExportActionResult = {
  writtenFiles?: string[];
  warnings?: string[];
};

type LastActionState =
  | { kind: "idle" }
  | { kind: ActionNoticeTone; title: string; body: string };

const stackStyle: CSSProperties = { display: "grid", gap: 12 };
const cardStyle: CSSProperties = {
  border: "1px solid var(--border, #2f3545)",
  borderRadius: 12,
  padding: 14,
  background: "color-mix(in srgb, var(--card, transparent) 82%, transparent)",
};
const compactCardStyle: CSSProperties = { ...cardStyle, padding: 10, gap: 8 };
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const gridStyle: CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" };
const codeStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  borderRadius: 8,
  border: "1px solid var(--border, #2f3545)",
  overflowX: "auto",
  fontSize: 11,
  lineHeight: 1.45,
};

function buttonStyle(tone: "default" | "primary" | "warn" = "default"): CSSProperties {
  if (tone === "primary") {
    return {
      border: "1px solid var(--foreground, #fff)",
      borderRadius: 999,
      padding: "6px 12px",
      background: "var(--foreground, #fff)",
      color: "var(--background, #000)",
      cursor: "pointer",
      fontSize: 12,
    };
  }
  if (tone === "warn") {
    return {
      border: "1px solid color-mix(in srgb, #d97706 60%, var(--border, #2f3545))",
      borderRadius: 999,
      padding: "6px 12px",
      background: "color-mix(in srgb, #d97706 16%, transparent)",
      color: "#fcd34d",
      cursor: "pointer",
      fontSize: 12,
    };
  }
  return {
    border: "1px solid var(--border, #2f3545)",
    borderRadius: 999,
    padding: "6px 12px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 12,
  };
}

function pillStyle(status: "ok" | "warning" | "error" | "info"): CSSProperties {
  const colors = {
    ok: { border: "#16a34a", text: "#86efac", bg: "#16a34a" },
    warning: { border: "#d97706", text: "#fcd34d", bg: "#d97706" },
    error: { border: "#dc2626", text: "#fca5a5", bg: "#dc2626" },
    info: { border: "#2563eb", text: "#93c5fd", bg: "#2563eb" },
  } as const;
  const tone = colors[status];
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    border: `1px solid color-mix(in srgb, ${tone.border} 60%, var(--border, #2f3545))`,
    background: `color-mix(in srgb, ${tone.bg} 16%, transparent)`,
    color: tone.text,
    padding: "2px 8px",
    fontSize: 11,
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof (error as PluginBridgeError).message === "string") {
    return (error as PluginBridgeError).message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    const detail = body.trim().length > 0 ? ` ${body.trim()}` : "";
    throw new Error(`Host API request failed (${response.status}) for ${url}.${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}

function companyApiPath(companyId: string, suffix: string): string {
  return `${OPENCODE_PROJECT_HOST_API_BASE_PATH}/companies/${encodeURIComponent(companyId)}${suffix}`;
}

function agentApiPath(agentId: string, suffix = ""): string {
  return `${OPENCODE_PROJECT_HOST_API_BASE_PATH}/agents/${encodeURIComponent(agentId)}${suffix}`;
}

function buildProjectTabHref(companyPrefix: string | null, projectId: string): string {
  const prefix = companyPrefix && companyPrefix.trim().length > 0 ? companyPrefix : "/app";
  return `${prefix}/projects/${encodeURIComponent(projectId)}`;
}

async function applySyncPlan(companyId: string, plan: SyncPlanResult) {
  const agentIdByExternalKey = new Map<string, string>();
  for (const upsert of plan.agentUpserts) {
    let agentId = upsert.paperclipAgentId;
    if (upsert.operation === "create") {
      const created = await apiJson<{ id: string }>(companyApiPath(companyId, "/agents"), {
        method: "POST",
        body: JSON.stringify({
          name: upsert.payload.name,
          role: "general",
          title: upsert.payload.title,
          reportsTo: upsert.payload.reportsTo,
          adapterType: upsert.payload.adapterType,
          adapterConfig: upsert.payload.adapterConfig,
          metadata: upsert.payload.metadata,
        }),
      });
      agentId = created.id;
    } else if (agentId) {
      await apiJson(agentApiPath(agentId), {
        method: "PATCH",
        body: JSON.stringify({
          name: upsert.payload.name,
          title: upsert.payload.title,
          adapterType: upsert.payload.adapterType,
          adapterConfig: upsert.payload.adapterConfig,
          replaceAdapterConfig: true,
          metadata: upsert.payload.metadata,
        }),
      });
    }
    if (!agentId) {
      throw new Error(`Agent '${upsert.externalAgentKey}' could not be mapped to a Paperclip agent id during sync.`);
    }
    agentIdByExternalKey.set(upsert.externalAgentKey, agentId);
  }

  return {
    appliedAgents: Array.from(agentIdByExternalKey, ([externalAgentKey, paperclipAgentId]) => ({ externalAgentKey, paperclipAgentId })),
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "grid", gap: 10 }}>
        <strong>{title}</strong>
        {children}
      </div>
    </section>
  );
}

function SummaryPill({ label, status }: { label: string; status: "ok" | "warning" | "error" | "info" }) {
  return <span style={pillStyle(status)}>{label}</span>;
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, opacity: 0.68, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 12, lineHeight: 1.45 }}>{value}</span>
    </div>
  );
}

function InlineNotice({ title, body, tone }: { title: string; body: string; tone: "info" | "warning" | "error" | "success" }) {
  const toneMap = {
    info: "info",
    warning: "warning",
    error: "error",
    success: "ok",
  } as const;
  return (
    <div style={{ ...cardStyle, padding: 12 }}>
      <div style={rowStyle}>
        <SummaryPill label={title} status={toneMap[tone]} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function getAgentModelWarning(repoRelPath: string, warnings: string[]): string | null {
  return warnings.find((warning) => warning.startsWith(`${repoRelPath}:`) && warning.includes("Frontmatter field 'model'")) ?? null;
}

function getAgentModelOutcome(args: {
  repoRelPath: string;
  declaredModel: string | null;
  warnings: string[];
  wasImportedBefore: boolean;
}): { summary: string; detail: string; warning: string | null } {
  const warning = getAgentModelWarning(args.repoRelPath, args.warnings);
  if (args.declaredModel) {
    return {
      summary: `Effective model: ${args.declaredModel}`,
      detail: "Declared frontmatter.model will override any previously saved synced model on import/update.",
      warning,
    };
  }
  if (warning) {
    return {
      summary: args.wasImportedBefore
        ? "Effective model: keep the existing saved Paperclip model"
        : `Effective model: shared default (${DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL})`,
      detail: args.wasImportedBefore
        ? "Invalid frontmatter.model is ignored; refresh sync preserves the current saved Paperclip model for this already-imported agent."
        : `Invalid frontmatter.model is ignored; first import falls back to the shared default model ${DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL}.`,
      warning,
    };
  }
  return {
    summary: args.wasImportedBefore
      ? "Effective model: keep the existing saved Paperclip model"
      : `Effective model: shared default (${DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL})`,
    detail: args.wasImportedBefore
      ? "No frontmatter.model is declared; refresh sync preserves the current saved Paperclip model for this already-imported agent."
      : `No frontmatter.model is declared; first import falls back to the shared default model ${DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL}.`,
    warning: null,
  };
}

function ProjectOpenCodePanel({ compact = false }: { compact?: boolean }): ReactElement {
  const context = useHostContext();
  const toast = usePluginToast();
  const bootstrapProject = usePluginAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY);
  const syncProject = usePluginAction(OPENCODE_PROJECT_SYNC_ACTION_KEY);
  const finalizeSyncProject = usePluginAction(OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY);
  const exportProject = usePluginAction(OPENCODE_PROJECT_EXPORT_ACTION_KEY);
  const testRuntime = usePluginAction(OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY);
  const linkRemoteProjectContext = usePluginAction(OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY);
  const refreshRemoteLink = usePluginAction(OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY);
  const clearRemoteLink = usePluginAction(OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY);

  if (!context.companyId || !context.projectId) {
    return (
      <InlineNotice
        title="OpenCode unavailable"
        body="This surface requires a company-scoped project context before bootstrap, sync, export, or runtime tests can run."
        tone="info"
      />
    );
  }

  return (
    <ProjectOpenCodePanelLoaded
      companyId={context.companyId}
      projectId={context.projectId}
      compact={compact}
      toast={toast}
      companyPrefix={context.companyPrefix}
      bootstrapProject={bootstrapProject}
      syncProject={syncProject}
      finalizeSyncProject={finalizeSyncProject}
      exportProject={exportProject}
      testRuntime={testRuntime}
      linkRemoteProjectContext={linkRemoteProjectContext}
      refreshRemoteLink={refreshRemoteLink}
      clearRemoteLink={clearRemoteLink}
    />
  );
}

function ProjectOpenCodePanelLoaded({
  companyId,
  projectId,
  compact,
  toast,
  companyPrefix,
  bootstrapProject,
  syncProject,
  finalizeSyncProject,
  exportProject,
  testRuntime,
  linkRemoteProjectContext,
  refreshRemoteLink,
  clearRemoteLink,
}: {
  companyId: string;
  projectId: string;
  compact: boolean;
  toast: ReturnType<typeof usePluginToast>;
  companyPrefix: string | null;
  bootstrapProject: (params?: Record<string, unknown>) => Promise<unknown>;
  syncProject: (params?: Record<string, unknown>) => Promise<unknown>;
  finalizeSyncProject: (params?: Record<string, unknown>) => Promise<unknown>;
  exportProject: (params?: Record<string, unknown>) => Promise<unknown>;
  testRuntime: (params?: Record<string, unknown>) => Promise<unknown>;
  linkRemoteProjectContext: (params?: Record<string, unknown>) => Promise<unknown>;
  refreshRemoteLink: (params?: Record<string, unknown>) => Promise<unknown>;
  clearRemoteLink: (params?: Record<string, unknown>) => Promise<unknown>;
}): ReactElement {
  const stateQuery = usePluginData<StateData>(OPENCODE_PROJECT_SYNC_STATE_DATA_KEY, { companyId, projectId });
  const previewQuery = usePluginData<PreviewData>(OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY, { companyId, projectId });
  const remoteStatusQuery = usePluginData<RemoteModeStatusData>(OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY, { companyId, projectId });

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [runtimeMode, setRuntimeMode] = useState<"canonical" | "resolved_execution_workspace">("canonical");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastActionState>({ kind: "idle" });
  const [runtimeResult, setRuntimeResult] = useState<RuntimeTestResult | null>(null);
  const [selectedAgentPaths, setSelectedAgentPaths] = useState<string[]>([]);
  const [remoteBaseUrlInput, setRemoteBaseUrlInput] = useState("");

  const state = stateQuery.data?.state ?? null;
  const workspace = stateQuery.data?.workspace ?? null;
  const preview = previewQuery.data?.preview ?? null;
  const remoteStatus = remoteStatusQuery.data ?? null;

  useEffect(() => {
    setRemoteBaseUrlInput(remoteStatus?.companyBaseUrlDefault ?? remoteStatus?.remoteLink?.baseUrl ?? "");
  }, [remoteStatus?.companyBaseUrlDefault, remoteStatus?.remoteLink?.baseUrl]);

  useEffect(() => {
    if (!state?.importedAgents?.length) {
      setSelectedAgentId("");
      return;
    }
    if (state.importedAgents.some((entry) => entry.paperclipAgentId === selectedAgentId)) return;
    setSelectedAgentId(state.importedAgents[0]?.paperclipAgentId ?? "");
  }, [selectedAgentId, state?.importedAgents]);

  const eligibleAgents = preview?.eligibleAgents ?? [];
  const eligibleAgentPaths = useMemo(() => eligibleAgents.map((agent) => agent.repoRelPath), [eligibleAgents]);
  const importedAgentRepoPaths = useMemo(() => new Set((state?.importedAgents ?? []).map((agent) => agent.repoRelPath)), [state?.importedAgents]);
  const duplicateExternalAgentKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of eligibleAgents) {
      counts.set(agent.externalAgentKey, (counts.get(agent.externalAgentKey) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort();
  }, [eligibleAgents]);
  const hasSelectionIdentityCollision = duplicateExternalAgentKeys.length > 0;
  const selectedAgentKeys = useMemo(() => eligibleAgents
    .filter((agent) => selectedAgentPaths.includes(agent.repoRelPath))
    .map((agent) => agent.externalAgentKey), [eligibleAgents, selectedAgentPaths]);

  useEffect(() => {
    if (!preview) return;
    const eligibleSet = new Set(eligibleAgentPaths);
    const persisted = (state?.selectedAgents ?? [])
      .map((agent) => agent.repoRelPath)
      .filter((repoRelPath) => eligibleSet.has(repoRelPath));

    setSelectedAgentPaths((current) => {
      const filteredCurrent = current.filter((repoRelPath) => eligibleSet.has(repoRelPath));
      const next = filteredCurrent.length > 0 ? filteredCurrent : persisted;
      if (next.length === current.length && next.every((repoRelPath, index) => repoRelPath === current[index])) {
        return current;
      }
      return next;
    });
  }, [eligibleAgentPaths, preview, state?.selectedAgents]);

  const syncSummary = useMemo(() => {
    if (stateQuery.error) return { label: "Bootstrap required", tone: "warning" as const };
    if (!state) return { label: "Loading", tone: "info" as const };
    if (state.conflicts.length > 0) return { label: "Blocked by conflict", tone: "error" as const };
    if (!state.lastImportedAt) return { label: "Never imported", tone: "warning" as const };
    if (state.warnings.length > 0) return { label: "Imported with warnings", tone: "warning" as const };
    return { label: "Imported and current", tone: "ok" as const };
  }, [state, stateQuery.error]);

  const persistedRuntimeResult = state?.lastRuntimeTestResult ?? null;
  const displayedRuntimeResult = runtimeResult ?? persistedRuntimeResult;
  const selectedEligibleCount = selectedAgentPaths.length;
  const ignoredSkillCount = preview?.ignoredArtifacts.filter((artifact) => artifact.kind === "skill").length ?? 0;
  const ignoredRootAgentsCount = preview?.ignoredArtifacts.filter((artifact) => artifact.kind === "root_agents_md").length ?? 0;

  const bootstrapSummary = useMemo(() => {
    if (stateQuery.error) {
      const message = stateQuery.error.message;
      if (message.includes("no primary workspace")) return { label: "No canonical workspace", tone: "warning" as const };
      if (message.includes("local checkout") || message.includes("does not exist on disk") || message.includes("repo binding")) {
        return { label: "Workspace needs local repo", tone: "warning" as const };
      }
      return { label: "Bootstrap blocked", tone: "error" as const };
    }
    if (!state?.bootstrapCompletedAt) return { label: "Ready to bootstrap", tone: "info" as const };
    return { label: "Canonical workspace ready", tone: "ok" as const };
  }, [state?.bootstrapCompletedAt, stateQuery.error]);

  const runtimeSummary = useMemo(() => {
    if (displayedRuntimeResult) {
      return displayedRuntimeResult.ok
        ? { label: "Last test succeeded", tone: "ok" as const }
        : { label: "Runtime test unavailable", tone: "warning" as const };
    }
    if (state?.lastRuntimeTestAt) return { label: "Last test recorded", tone: "info" as const };
    return { label: "Not tested", tone: "info" as const };
  }, [displayedRuntimeResult, state?.lastRuntimeTestAt]);

  const remoteSummary = useMemo(() => {
    if (!remoteStatus) return { label: "Remote status loading", tone: "info" as const };
    if (!remoteStatus.remoteLink) return { label: "Not linked", tone: "info" as const };
    if (remoteStatus.remoteLink.status === "linked") return { label: "Remote linked", tone: "ok" as const };
    if (remoteStatus.remoteLink.status === "stale") return { label: "Remote stale", tone: "warning" as const };
    return { label: "Remote broken", tone: "error" as const };
  }, [remoteStatus]);

  const canRunRuntimeTest = Boolean(selectedAgentId) && runningAction === null;
  const canSyncSelection = Boolean(state) && runningAction === null && selectedEligibleCount > 0 && !hasSelectionIdentityCollision;

  function confirmGuardedExport(): boolean {
    if (typeof window === "undefined") return true;
    return window.confirm(
      "Export only sync-managed imported top-level agents back into the canonical repo? Repo drift remains guarded and may block the export.",
    );
  }

  function handleExport(): void {
    if (!state || !confirmGuardedExport()) return;
    void runAction("export", async () => exportProject({
      companyId,
      projectId,
      exportAgents: true,
    }), (result) => {
      const summary = result as ExportActionResult;
      setLastAction({
        kind: "success",
        title: "Export completed",
        body: summary.writtenFiles?.length
          ? `Wrote ${summary.writtenFiles.length} top-level agent file(s): ${summary.writtenFiles.join(", ")}. Exported 0 skills.`
          : "No sync-managed imported top-level agents matched the guarded export selection. Exported 0 skills.",
      });
      toast({ title: "OpenCode export completed", tone: "success" });
    });
  }

  function handleRuntimeTest(): void {
    if (!selectedAgentId) return;
    void runAction("test", () => testRuntime({ companyId, projectId, agentId: selectedAgentId, workspaceMode: runtimeMode }), (result) => {
      const next = result as RuntimeTestResult;
      setRuntimeResult(next);
      const tone: ActionNoticeTone = next.ok ? "success" : "warning";
      setLastAction({
        kind: tone,
        title: next.ok ? "Runtime test finished" : "Runtime test unavailable",
        body: next.message,
      });
      toast({
        title: next.ok ? "OpenCode runtime test finished" : "OpenCode runtime test unavailable",
        body: next.message,
        tone: next.ok ? "success" : "warn",
      });
    });
  }

  async function runAction(
    key: "bootstrap" | "sync" | "export" | "test" | "link" | "refresh-link" | "clear-link" | "save-base-url",
    run: () => Promise<unknown>,
    onSuccess: (result: unknown) => void,
  ) {
    setRunningAction(key);
    setLastAction({ kind: "idle" });
    try {
      const result = await run();
      onSuccess(result);
      stateQuery.refresh();
      previewQuery.refresh();
      remoteStatusQuery.refresh();
    } catch (error) {
      const message = formatError(error);
      setLastAction({ kind: "error", title: "Action failed", body: message });
      toast({ title: "OpenCode action failed", body: message, tone: "error" });
    } finally {
      setRunningAction(null);
    }
  }

  function handleLinkRemote(): void {
    const trimmedBaseUrl = remoteBaseUrlInput.trim();
    void runAction("link", () => linkRemoteProjectContext({
      companyId,
      projectId,
      ...(trimmedBaseUrl.length > 0 ? { baseUrl: trimmedBaseUrl } : {}),
    }), (result) => {
      const summary = result as { updatedImportedAgentCount: number; remoteLink: { linkedDirectoryHint: string } };
      setLastAction({
        kind: "success",
        title: "Remote project linked",
        body: `Linked the project-level remote context and propagated ${summary.updatedImportedAgentCount} imported agent update(s) using directory hint ${summary.remoteLink.linkedDirectoryHint}.`,
      });
      toast({ title: "Remote project linked", tone: "success" });
    });
  }

  async function saveRemoteBaseUrlDefault(): Promise<void> {
    const trimmed = remoteBaseUrlInput.trim();
    if (trimmed.length === 0) {
      throw new Error("Remote base URL is required before saving.");
    }
    new URL(trimmed);

    const existingConfig = await apiJson<PluginConfigResponse>(
      `/api/plugins/${encodeURIComponent(OPENCODE_PROJECT_SYNC_PLUGIN_ID)}/config`,
    );

    await apiJson(`/api/plugins/${encodeURIComponent(OPENCODE_PROJECT_SYNC_PLUGIN_ID)}/config`, {
      method: "POST",
      body: JSON.stringify({
        configJson: {
          ...(existingConfig?.configJson ?? {}),
          remoteServerDefault: {
            mode: "fixed",
            baseUrl: trimmed,
          },
        },
      }),
    });
  }

  function handleSaveRemoteBaseUrl(): void {
    void runAction("save-base-url", async () => {
      await saveRemoteBaseUrlDefault();
      return { ok: true };
    }, () => {
      setLastAction({
        kind: "success",
        title: "Remote base URL saved",
        body: `Saved company default OpenCode base URL as ${remoteBaseUrlInput.trim()}.`,
      });
      toast({ title: "Remote base URL saved", tone: "success" });
    });
  }

  function handleRefreshRemote(): void {
    void runAction("refresh-link", () => refreshRemoteLink({ companyId, projectId }), (result) => {
      const summary = result as { updatedImportedAgentCount: number; remoteLink: { status: string } };
      setLastAction({
        kind: summary.remoteLink.status === "linked" ? "success" : "warning",
        title: "Remote link refreshed",
        body: summary.remoteLink.status === "linked"
          ? `Remote link is still valid. Propagated ${summary.updatedImportedAgentCount} imported agent update(s).`
          : `Remote link is now ${summary.remoteLink.status}. Review status before syncing or running remotely.`,
      });
      toast({ title: "Remote link refreshed", tone: summary.remoteLink.status === "linked" ? "success" : "warn" });
    });
  }

  function handleClearRemote(): void {
    void runAction("clear-link", () => clearRemoteLink({ companyId, projectId }), (result) => {
      const summary = result as { updatedImportedAgentCount: number };
      setLastAction({
        kind: "success",
        title: "Remote link cleared",
        body: `Cleared canonical remote link state and reset ${summary.updatedImportedAgentCount} managed imported agent(s) to server_default remote targeting.`,
      });
      toast({ title: "Remote link cleared", tone: "success" });
    });
  }

  if (compact) {
    return (
      <section style={compactCardStyle} aria-label="OpenCode project quick actions">
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <strong>OpenCode</strong>
          <SummaryPill label={syncSummary.label} status={syncSummary.tone} />
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Canonical workspace is the phase-1 sync anchor. Export stays explicit and guarded.
        </div>
        {stateQuery.error ? <div style={{ fontSize: 12, color: "#fca5a5" }}>{stateQuery.error.message}</div> : null}
        <div style={rowStyle}>
          <button
            type="button"
            style={buttonStyle("primary")}
            disabled={runningAction !== null}
            onClick={() => void runAction("bootstrap", () => bootstrapProject({ companyId, projectId }), () => {
              setLastAction({ kind: "success", title: "Bootstrap complete", body: "Canonical workspace binding refreshed." });
            })}
          >
            {runningAction === "bootstrap" ? "Bootstrapping…" : "Bootstrap"}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            disabled={!canSyncSelection}
            onClick={() => void runAction("sync", async () => {
              const plan = await syncProject({ companyId, projectId, mode: state?.lastImportedAt ? "refresh" : "import", dryRun: false, selectedAgentKeys }) as SyncPlanResult;
              const { appliedAgents } = await applySyncPlan(companyId, plan);
              return await finalizeSyncProject({
                companyId,
                projectId,
                workspaceId: plan.workspaceId,
                importedAt: new Date().toISOString(),
                lastScanFingerprint: plan.lastScanFingerprint,
                selectedAgentKeys,
                warnings: plan.warnings ?? [],
                agentUpserts: plan.agentUpserts,
                appliedAgents,
              });
            }, (result) => {
              const summary = result as SyncActionResult;
              setLastAction({
                kind: "success",
                title: "Sync completed",
                body: `${summary.importedAgentCount ?? 0} selected top-level agents created, ${summary.updatedAgentCount ?? 0} updated; 0 skills created, 0 updated.`,
              });
            })}
          >
            {runningAction === "sync" ? "Syncing…" : state?.lastImportedAt ? "Refresh sync" : "Import now"}
          </button>
          <button type="button" style={buttonStyle("warn")} disabled={runningAction !== null || !state} onClick={handleExport}>
            {runningAction === "export" ? "Exporting…" : "Export"}
          </button>
          <button type="button" style={buttonStyle()} disabled={!canRunRuntimeTest} onClick={handleRuntimeTest}>
            {runningAction === "test" ? "Testing…" : "Test runtime"}
          </button>
          <a href={buildProjectTabHref(companyPrefix, projectId)} style={{ ...buttonStyle(), textDecoration: "none" }}>Open detail</a>
        </div>
        <div style={{ fontSize: 12, opacity: 0.72 }}>
          {hasSelectionIdentityCollision
            ? `Selection is blocked because multiple eligible files resolve to the same external agent key: ${duplicateExternalAgentKeys.join(", ")}.`
            : selectedEligibleCount > 0
            ? `${selectedEligibleCount} top-level agent${selectedEligibleCount === 1 ? "" : "s"} selected. Import/export applies to 0 skills in this flow.`
            : "Select at least one eligible top-level agent before importing. Skills and root AGENTS.md are not part of this flow."}
        </div>
        {!selectedAgentId ? <div style={{ fontSize: 12, opacity: 0.72 }}>Test runtime becomes available after at least one agent is imported.</div> : null}
      </section>
    );
  }

  return (
    <div style={stackStyle}>
      <Section title="OpenCode project sync">
        <div style={rowStyle}>
          <SummaryPill label={bootstrapSummary.label} status={bootstrapSummary.tone} />
          <SummaryPill label={syncSummary.label} status={syncSummary.tone} />
          <SummaryPill label={remoteSummary.label} status={remoteSummary.tone} />
          <SummaryPill label={state?.sourceOfTruth === "paperclip_export_guarded" ? "Guarded export enabled" : "Repo-first source of truth"} status="info" />
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
          The canonical Paperclip project workspace remains the import/export anchor. Remote mode links an existing OpenCode project context through stable project/path/session APIs only; no workspace provisioning/runtime is implied.
        </div>
        <div style={rowStyle}>
          <button
            type="button"
            style={buttonStyle("primary")}
            disabled={runningAction !== null}
            onClick={() => void runAction("bootstrap", () => bootstrapProject({ companyId, projectId }), () => {
              setLastAction({ kind: "success", title: "Bootstrap complete", body: "Canonical workspace binding and discovery preview were refreshed." });
              toast({ title: "OpenCode bootstrap complete", tone: "success" });
            })}
          >
            {runningAction === "bootstrap" ? "Bootstrapping…" : "Bootstrap"}
          </button>
          <button
            type="button"
            style={buttonStyle()}
            disabled={!canSyncSelection}
            onClick={() => void runAction("sync", async () => {
              const plan = await syncProject({ companyId, projectId, mode: state?.lastImportedAt ? "refresh" : "import", dryRun: false, selectedAgentKeys }) as SyncPlanResult;
              const { appliedAgents } = await applySyncPlan(companyId, plan);
              return await finalizeSyncProject({
                companyId,
                projectId,
                workspaceId: plan.workspaceId,
                importedAt: new Date().toISOString(),
                lastScanFingerprint: plan.lastScanFingerprint,
                selectedAgentKeys,
                warnings: plan.warnings ?? [],
                agentUpserts: plan.agentUpserts,
                appliedAgents,
              });
            }, (result) => {
              const summary = result as SyncActionResult;
              setLastAction({
                kind: "success",
                title: "Sync completed",
                body: `${summary.importedAgentCount ?? 0} selected top-level agents created, ${summary.updatedAgentCount ?? 0} updated; 0 skills created, 0 updated.`,
              });
              toast({ title: "OpenCode sync completed", tone: "success" });
            })}
          >
            {runningAction === "sync" ? "Syncing…" : state?.lastImportedAt ? "Refresh sync" : "Import now"}
          </button>
          <button
            type="button"
            style={buttonStyle("warn")}
            disabled={runningAction !== null || !state}
            onClick={handleExport}
          >
            {runningAction === "export" ? "Exporting…" : "Guarded export"}
          </button>
          <button type="button" style={buttonStyle()} disabled={runningAction !== null} onClick={handleLinkRemote}>
            {runningAction === "link" ? "Linking…" : remoteStatus?.remoteLink ? "Relink remote" : "Link remote"}
          </button>
          <button type="button" style={buttonStyle()} disabled={runningAction !== null || !remoteStatus?.remoteLink} onClick={handleRefreshRemote}>
            {runningAction === "refresh-link" ? "Refreshing…" : "Refresh remote"}
          </button>
          <button type="button" style={buttonStyle("warn")} disabled={runningAction !== null || !remoteStatus?.remoteLink} onClick={handleClearRemote}>
            {runningAction === "clear-link" ? "Clearing…" : "Clear remote"}
          </button>
        </div>
      </Section>

      {remoteStatus ? (
        <Section title="Remote project context">
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
              <strong>Remote OpenCode base URL</strong>
              <input
                type="url"
                value={remoteBaseUrlInput}
                onChange={(event) => setRemoteBaseUrlInput(event.target.value)}
                placeholder="http://127.0.0.1:4096"
                style={{
                  width: "100%",
                  border: "1px solid var(--border, #2f3545)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 12,
                }}
              />
            </label>
            <div style={rowStyle}>
              <button type="button" style={buttonStyle()} disabled={runningAction !== null} onClick={handleSaveRemoteBaseUrl}>
                {runningAction === "save-base-url" ? "Saving…" : "Save base URL"}
              </button>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
              This value is stored as the plugin company default and used by Link remote when no explicit override is passed.
            </div>
          </div>
          <div style={gridStyle}>
            <KeyValue label="Company default base URL" value={remoteStatus.companyBaseUrlDefault ?? "Unset"} />
            <KeyValue label="Canonical workspace id" value={remoteStatus.canonicalWorkspaceId} />
            <KeyValue label="Canonical repo root" value={remoteStatus.canonicalRepoRoot} />
            <KeyValue label="Remote sync gate" value={remoteStatus.syncAllowed ? "Sync allowed" : remoteStatus.syncBlockReason ?? "Blocked"} />
            <KeyValue label="Link status" value={remoteStatus.remoteLink?.status ?? "not_linked"} />
            <KeyValue label="Linked directory hint" value={remoteStatus.remoteLink?.linkedDirectoryHint ?? "Not linked"} />
          </div>
          {remoteStatus.remoteLink ? (
            <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
              Remote base URL: {remoteStatus.remoteLink.baseUrl}. Managed imported agents are rewritten automatically before link, refresh-with-change, or clear reports success.
            </div>
          ) : (
            <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
              This project is not linked to a remote OpenCode project context yet. Link uses only `/global/health`, `/project/current`, `/path`, `/vcs`, and a validation `POST /session` probe.
            </div>
          )}
          {remoteStatus.syncBlockReason ? <InlineNotice title="Remote sync gating" body={remoteStatus.syncBlockReason} tone="warning" /> : null}
        </Section>
      ) : null}

      {stateQuery.loading && !state ? <InlineNotice title="Loading" body="Resolving canonical workspace binding and sync state…" tone="info" /> : null}
      {stateQuery.error ? <InlineNotice title="Bootstrap state" body={stateQuery.error.message} tone="warning" /> : null}

      {lastAction.kind !== "idle" ? (
        <InlineNotice title={lastAction.title} body={lastAction.body} tone={lastAction.kind} />
      ) : null}

      {workspace && state ? (
        <Section title="Canonical workspace binding">
          <div style={gridStyle}>
            <KeyValue label="Workspace id" value={workspace.workspaceId} />
            <KeyValue label="Repo root" value={workspace.cwd} />
            <KeyValue label="Repo URL" value={workspace.repoUrl ?? "Not recorded"} />
            <KeyValue label="Repo ref" value={workspace.repoRef ?? "Not recorded"} />
            <KeyValue label="Source of truth" value={state.sourceOfTruth === "repo_first" ? "Repo/OpenCode remains authoritative in phase 1" : "Paperclip export is explicit and guarded"} />
            <KeyValue label="Last scan fingerprint" value={state.lastScanFingerprint ?? preview?.lastScanFingerprint ?? "Not scanned yet"} />
          </div>
        </Section>
      ) : null}

      {state ? (
        <Section title="Sync and export status">
          <div style={gridStyle}>
            <KeyValue label="Bootstrap completed" value={formatDate(state.bootstrapCompletedAt)} />
            <KeyValue label="Last import" value={formatDate(state.lastImportedAt)} />
            <KeyValue label="Last export" value={formatDate(state.lastExportedAt)} />
            <KeyValue label="Last runtime test" value={formatDate(state.lastRuntimeTestAt)} />
            <KeyValue label="Runtime status" value={runtimeSummary.label} />
            <KeyValue label="Selected top-level agents" value={String(state.selectedAgents?.length ?? 0)} />
            <KeyValue label="Imported agents" value={String(state.importedAgents.length)} />
            <KeyValue label="Imported skills" value="0" />
          </div>
          {state.conflicts.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {state.conflicts.map((conflict) => (
                <div key={`${conflict.code}:${conflict.entityKey ?? conflict.message}`} style={{ ...cardStyle, padding: 10, borderColor: "color-mix(in srgb, #dc2626 55%, var(--border, #2f3545))" }}>
                  <div style={rowStyle}>
                    <SummaryPill label={conflict.code} status="error" />
                    {conflict.repoRelPath ? <span style={{ fontSize: 11, opacity: 0.72 }}>{conflict.repoRelPath}</span> : null}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12 }}>{conflict.message}</div>
                </div>
              ))}
            </div>
          ) : null}
          {state.warnings.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              {state.warnings.map((warning) => (
                <div key={warning} style={{ ...cardStyle, padding: 10, borderColor: "color-mix(in srgb, #d97706 55%, var(--border, #2f3545))" }}>
                  <div style={{ fontSize: 12 }}>{warning}</div>
                </div>
              ))}
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title="Discovery preview">
        {previewQuery.error ? <div style={{ fontSize: 12, color: "#fca5a5" }}>{previewQuery.error.message}</div> : null}
        {preview ? (
          <>
            <div style={gridStyle}>
              <KeyValue label="Eligible top-level agents" value={String(preview.eligibleAgents.length)} />
              <KeyValue label="Excluded nested agents" value={String(preview.ineligibleNestedAgents.length)} />
              <KeyValue label="Ignored skills" value={String(ignoredSkillCount)} />
              <KeyValue label="Ignored root AGENTS.md" value={String(ignoredRootAgentsCount)} />
              <KeyValue label="Latest scan fingerprint" value={preview.lastScanFingerprint} />
            </div>
            {preview.warnings.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {preview.warnings.map((warning) => (
                  <div key={warning} style={{ ...cardStyle, padding: 10 }}>
                    <div style={rowStyle}>
                      <SummaryPill label="discovery warning" status="warning" />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12 }}>{warning}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {hasSelectionIdentityCollision ? (
              <div style={{ ...cardStyle, padding: 10, borderColor: "color-mix(in srgb, #d97706 55%, var(--border, #2f3545))" }}>
                <div style={{ ...rowStyle, marginBottom: 6 }}>
                  <SummaryPill label="selection blocked" status="warning" />
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                  Multiple eligible files resolve to the same external agent key ({duplicateExternalAgentKeys.join(", ")}). Import stays disabled until discovery is unambiguous.
                </div>
              </div>
            ) : null}
            <div style={{ ...cardStyle, padding: 10, fontSize: 12, lineHeight: 1.55 }}>
              Skills are not imported or exported in this redesign, and repo-root <code>AGENTS.md</code> is ignored. Nested agents remain internal to OpenCode and are shown only as excluded context.
            </div>
            <div style={gridStyle}>
              <div style={cardStyle}>
                <div style={{ ...rowStyle, justifyContent: "space-between", marginBottom: 8 }}>
                  <strong>Eligible top-level agents</strong>
                  <div style={rowStyle}>
                    <button type="button" style={buttonStyle()} disabled={eligibleAgents.length === 0} onClick={() => setSelectedAgentPaths(eligibleAgentPaths)}>
                      Select all
                    </button>
                    <button type="button" style={buttonStyle()} disabled={selectedEligibleCount === 0} onClick={() => setSelectedAgentPaths([])}>
                      Clear all
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {preview.eligibleAgents.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No eligible top-level agents discovered yet.</div> : null}
                  {preview.eligibleAgents.map((agent) => (
                    <label key={agent.repoRelPath} style={{ display: "grid", gap: 4, fontSize: 12, lineHeight: 1.45, border: "1px solid var(--border, #2f3545)", borderRadius: 10, padding: 10 }}>
                      {(() => {
                        const modelOutcome = getAgentModelOutcome({
                          repoRelPath: agent.repoRelPath,
                          declaredModel: agent.frontmatter?.model ?? null,
                          warnings: preview.warnings,
                          wasImportedBefore: importedAgentRepoPaths.has(agent.repoRelPath),
                        });

                        return (
                          <>
                            <div style={{ ...rowStyle, flexWrap: "nowrap", alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={selectedAgentPaths.includes(agent.repoRelPath)}
                          onChange={(event) => {
                            setSelectedAgentPaths((current) => event.target.checked
                              ? [...current.filter((repoRelPath) => repoRelPath !== agent.repoRelPath), agent.repoRelPath]
                              : current.filter((repoRelPath) => repoRelPath !== agent.repoRelPath));
                          }}
                        />
                              <div style={{ display: "grid", gap: 4 }}>
                                <strong>{agent.displayName}</strong>
                                <div style={{ opacity: 0.74 }}>{agent.repoRelPath}</div>
                                <div style={{ opacity: 0.74 }}>External key: {agent.externalAgentKey}</div>
                                <div style={{ opacity: 0.74 }}>Role: {agent.role ?? "Not declared"} · Advisory mode: {agent.advisoryMode ?? "unspecified"}</div>
                                <div style={{ opacity: 0.74 }}>Declared frontmatter.model: {agent.frontmatter?.model ?? (modelOutcome.warning ? "Ignored/invalid" : "Not declared")}</div>
                                <div style={{ opacity: 0.9 }}>{modelOutcome.summary}</div>
                                <div style={{ opacity: 0.74 }}>{modelOutcome.detail}</div>
                                {modelOutcome.warning ? <div style={{ color: "#fcd34d" }}>{modelOutcome.warning}</div> : null}
                                {!state?.selectedAgents?.length && !agent.selectionDefault ? <div style={{ opacity: 0.74 }}>First bootstrap default: unchecked</div> : null}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </label>
                  ))}
                </div>
              </div>
              <div style={cardStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>Excluded nested agents</strong>
                <div style={{ display: "grid", gap: 8 }}>
                  {preview.ineligibleNestedAgents.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No nested agents were excluded.</div> : null}
                  {preview.ineligibleNestedAgents.map((agent) => (
                    <div key={agent.repoRelPath} style={{ fontSize: 12, lineHeight: 1.45 }}>
                      <strong>{agent.displayName}</strong>
                      <div style={{ opacity: 0.74 }}>{agent.repoRelPath}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ ...cardStyle, padding: 10, fontSize: 12, lineHeight: 1.55 }}>
              {selectedEligibleCount} selected top-level agent{selectedEligibleCount === 1 ? "" : "s"} will be created or updated. 0 skills will be imported. Nested agents remain internal to OpenCode.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.72 }}>Preview becomes available after the canonical workspace can be resolved.</div>
        )}
      </Section>

      <Section title="Runtime test">
        <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
          Runtime testing stays repo-first: it targets the canonical project binding and only uses an execution workspace when explicitly requested. Until an adapter-backed probe is wired through this package action, unavailable results are shown as unavailable rather than success.
        </div>
        <div style={rowStyle}>
          <SummaryPill label={runtimeSummary.label} status={runtimeSummary.tone} />
        </div>
        <div style={rowStyle}>
          <label style={{ fontSize: 12 }}>
            Agent:{" "}
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} style={{ minWidth: 240 }}>
              <option value="">Select imported agent</option>
              {(state?.importedAgents ?? []).map((agent) => (
                <option key={agent.paperclipAgentId} value={agent.paperclipAgentId}>
                  {agent.externalAgentName ?? agent.externalAgentKey}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Workspace mode:{" "}
            <select value={runtimeMode} onChange={(event) => setRuntimeMode(event.target.value as "canonical" | "resolved_execution_workspace")}>
              <option value="canonical">Canonical workspace</option>
              <option value="resolved_execution_workspace">Resolved execution workspace</option>
            </select>
          </label>
          <button
            type="button"
            style={buttonStyle()}
            disabled={!canRunRuntimeTest}
            onClick={handleRuntimeTest}
          >
            {runningAction === "test" ? "Testing…" : "Test runtime"}
          </button>
        </div>
        {!selectedAgentId ? <div style={{ fontSize: 12, opacity: 0.72 }}>Import at least one sync-managed agent before running the runtime test.</div> : null}
        {displayedRuntimeResult ? <pre style={codeStyle}>{JSON.stringify(displayedRuntimeResult, null, 2)}</pre> : <div style={{ fontSize: 12, opacity: 0.72 }}>No runtime test result is stored yet for this canonical workspace. If you run it now, the package will record and render the current probe status truthfully across refreshes.</div>}
      </Section>
    </div>
  );
}

export function ProjectToolbarButton(): ReactElement {
  return <ProjectOpenCodePanel compact />;
}

export function ProjectDetailTab(_props: PluginDetailTabProps): ReactElement {
  return <ProjectOpenCodePanel />;
}

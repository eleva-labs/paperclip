import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  useHostContext,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginDetailTabProps,
  type PluginProjectSidebarItemProps,
} from "@paperclipai/plugin-sdk/ui";
import {
  OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY,
  OPENCODE_PROJECT_EXPORT_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_ACTION_KEY,
  OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID,
  OPENCODE_PROJECT_SYNC_PLUGIN_ID,
  OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY,
  OPENCODE_PROJECT_SYNC_STATE_DATA_KEY,
  OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY,
} from "../manifest.js";

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
  warnings: string[];
  conflicts: Conflict[];
  importedAgents: SyncManifestAgent[];
  importedSkills: SyncManifestSkill[];
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
    discoveredAgentCount: number;
    discoveredSkillCount: number;
    warnings: Array<{ code: string; message: string }>;
    lastScanFingerprint: string;
    supportedFiles: string[];
    agents: Array<{
      externalAgentKey: string;
      displayName: string;
      repoRelPath: string;
      desiredSkillKeys: string[];
    }>;
    skills: Array<{
      externalSkillKey: string;
      displayName: string;
      repoRelPath: string;
    }>;
  };
};

type RuntimeTestResult = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

type ActionNoticeTone = "success" | "warning" | "error";

type SyncActionResult = {
  importedAgentCount?: number;
  updatedAgentCount?: number;
  importedSkillCount?: number;
  updatedSkillCount?: number;
  warnings?: string[];
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
  return error instanceof Error ? error.message : String(error);
}

function buildProjectTabHref(companyPrefix: string | null, projectId: string): string {
  const prefix = companyPrefix ? `/${companyPrefix}` : "";
  return `${prefix}/projects/${projectId}?tab=plugin:${OPENCODE_PROJECT_SYNC_PLUGIN_ID}:${OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID}`;
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

function ProjectOpenCodePanel({ compact = false }: { compact?: boolean }): ReactElement {
  const context = useHostContext();
  const toast = usePluginToast();
  const bootstrapProject = usePluginAction(OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY);
  const syncProject = usePluginAction(OPENCODE_PROJECT_SYNC_ACTION_KEY);
  const exportProject = usePluginAction(OPENCODE_PROJECT_EXPORT_ACTION_KEY);
  const testRuntime = usePluginAction(OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY);

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
      exportProject={exportProject}
      testRuntime={testRuntime}
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
  exportProject,
  testRuntime,
}: {
  companyId: string;
  projectId: string;
  compact: boolean;
  toast: ReturnType<typeof usePluginToast>;
  companyPrefix: string | null;
  bootstrapProject: (params?: Record<string, unknown>) => Promise<unknown>;
  syncProject: (params?: Record<string, unknown>) => Promise<unknown>;
  exportProject: (params?: Record<string, unknown>) => Promise<unknown>;
  testRuntime: (params?: Record<string, unknown>) => Promise<unknown>;
}): ReactElement {
  const stateQuery = usePluginData<StateData>(OPENCODE_PROJECT_SYNC_STATE_DATA_KEY, { companyId, projectId });
  const previewQuery = usePluginData<PreviewData>(OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY, { companyId, projectId });

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [runtimeMode, setRuntimeMode] = useState<"canonical" | "resolved_execution_workspace">("canonical");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastActionState>({ kind: "idle" });
  const [runtimeResult, setRuntimeResult] = useState<RuntimeTestResult | null>(null);

  const state = stateQuery.data?.state ?? null;
  const workspace = stateQuery.data?.workspace ?? null;
  const preview = previewQuery.data?.preview ?? null;

  useEffect(() => {
    if (!state?.importedAgents?.length) {
      setSelectedAgentId("");
      return;
    }
    if (state.importedAgents.some((entry) => entry.paperclipAgentId === selectedAgentId)) return;
    setSelectedAgentId(state.importedAgents[0]?.paperclipAgentId ?? "");
  }, [selectedAgentId, state?.importedAgents]);

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

  const canRunRuntimeTest = Boolean(selectedAgentId) && runningAction === null;

  function confirmGuardedExport(): boolean {
    if (typeof window === "undefined") return true;
    return window.confirm(
      "Export only sync-managed imported agents and skills back into the canonical repo? Repo drift remains guarded and may block the export.",
    );
  }

  function handleExport(): void {
    if (!state || !confirmGuardedExport()) return;
    void runAction("export", () => exportProject({ companyId, projectId, exportAgents: true, exportSkills: true }), (result) => {
      const summary = result as ExportActionResult;
      setLastAction({
        kind: "success",
        title: "Export completed",
        body: summary.writtenFiles?.length
          ? `Wrote ${summary.writtenFiles.length} file(s): ${summary.writtenFiles.join(", ")}`
          : "No sync-managed imported agents or skills matched the guarded export selection.",
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
    key: "bootstrap" | "sync" | "export" | "test",
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
    } catch (error) {
      const message = formatError(error);
      setLastAction({ kind: "error", title: "Action failed", body: message });
      toast({ title: "OpenCode action failed", body: message, tone: "error" });
    } finally {
      setRunningAction(null);
    }
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
            disabled={runningAction !== null}
            onClick={() => void runAction("sync", () => syncProject({ companyId, projectId, mode: state?.lastImportedAt ? "refresh" : "import", dryRun: false }), (result) => {
              const summary = result as SyncActionResult;
              setLastAction({
                kind: "success",
                title: "Sync completed",
                body: `${summary.importedAgentCount ?? 0} agents created, ${summary.updatedAgentCount ?? 0} updated; ${summary.importedSkillCount ?? 0} skills created, ${summary.updatedSkillCount ?? 0} updated.`,
              });
            })}
          >
            {runningAction === "sync" ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" style={buttonStyle("warn")} disabled={runningAction !== null || !state} onClick={handleExport}>
            {runningAction === "export" ? "Exporting…" : "Export"}
          </button>
          <button type="button" style={buttonStyle()} disabled={!canRunRuntimeTest} onClick={handleRuntimeTest}>
            {runningAction === "test" ? "Testing…" : "Test runtime"}
          </button>
          <a href={buildProjectTabHref(companyPrefix, projectId)} style={{ ...buttonStyle(), textDecoration: "none" }}>Open detail</a>
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
          <SummaryPill label={state?.sourceOfTruth === "paperclip_export_guarded" ? "Guarded export enabled" : "Repo-first source of truth"} status="info" />
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.82 }}>
          The canonical project workspace is the only phase-1 import/export anchor. Runtime may execute elsewhere, but the UI does not imply automatic bidirectional reconciliation.
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
            disabled={runningAction !== null}
            onClick={() => void runAction("sync", () => syncProject({ companyId, projectId, mode: state?.lastImportedAt ? "refresh" : "import", dryRun: false }), (result) => {
              const summary = result as SyncActionResult;
              setLastAction({
                kind: "success",
                title: "Sync completed",
                body: `${summary.importedAgentCount ?? 0} agents created, ${summary.updatedAgentCount ?? 0} updated; ${summary.importedSkillCount ?? 0} skills created, ${summary.updatedSkillCount ?? 0} updated.`,
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
        </div>
      </Section>

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
            <KeyValue label="Imported agents" value={String(state.importedAgents.length)} />
            <KeyValue label="Imported skills" value={String(state.importedSkills.length)} />
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
              <KeyValue label="Discovered agents" value={String(preview.discoveredAgentCount)} />
              <KeyValue label="Discovered skills" value={String(preview.discoveredSkillCount)} />
              <KeyValue label="Supported files" value={String(preview.supportedFiles.length)} />
              <KeyValue label="Latest scan fingerprint" value={preview.lastScanFingerprint} />
            </div>
            {preview.warnings.length > 0 ? (
              <div style={{ display: "grid", gap: 8 }}>
                {preview.warnings.map((warning) => (
                  <div key={`${warning.code}:${warning.message}`} style={{ ...cardStyle, padding: 10 }}>
                    <div style={rowStyle}>
                      <SummaryPill label={warning.code} status="warning" />
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12 }}>{warning.message}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div style={gridStyle}>
              <div style={cardStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>Agents</strong>
                <div style={{ display: "grid", gap: 8 }}>
                  {preview.agents.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No repo-local agents discovered yet.</div> : null}
                  {preview.agents.slice(0, 6).map((agent) => (
                    <div key={agent.externalAgentKey} style={{ fontSize: 12, lineHeight: 1.45 }}>
                      <strong>{agent.displayName}</strong>
                      <div style={{ opacity: 0.74 }}>{agent.repoRelPath}</div>
                      <div style={{ opacity: 0.74 }}>
                        Desired skills: {agent.desiredSkillKeys.length > 0 ? agent.desiredSkillKeys.join(", ") : "None declared"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={cardStyle}>
                <strong style={{ display: "block", marginBottom: 8 }}>Skills</strong>
                <div style={{ display: "grid", gap: 8 }}>
                  {preview.skills.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No repo-local skills discovered yet.</div> : null}
                  {preview.skills.slice(0, 6).map((skill) => (
                    <div key={skill.externalSkillKey} style={{ fontSize: 12, lineHeight: 1.45 }}>
                      <strong>{skill.displayName}</strong>
                      <div style={{ opacity: 0.74 }}>{skill.repoRelPath}</div>
                    </div>
                  ))}
                </div>
              </div>
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

export function ProjectSidebarItem({ context }: PluginProjectSidebarItemProps): ReactElement {
  const href = buildProjectTabHref(context.companyPrefix ?? null, context.entityId);
  return (
    <a href={href} style={{ ...cardStyle, display: "grid", gap: 8, textDecoration: "none", color: "inherit" }}>
      <div style={rowStyle}>
        <strong>OpenCode</strong>
        <SummaryPill label="Project tab" status="info" />
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.76 }}>
        Open the canonical workspace binding, repo-first sync status, guarded export, and runtime test panel.
      </div>
    </a>
  );
}

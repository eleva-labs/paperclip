import { describe, expect, it } from "vitest";
import { DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL } from "@paperclipai/shared";
import { buildImportPlan } from "./import-plan.js";
import type { OpencodeProjectSyncState } from "./sync-state.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const repoRoot = "/repos/canonical";
const importedAt = "2026-04-11T12:00:00.000Z";

function makeState(): OpencodeProjectSyncState {
  return {
    projectId,
    workspaceId,
    bootstrapCompletedAt: null,
    canonicalRepoRoot: repoRoot,
    canonicalRepoUrl: "https://example.com/acme/repo.git",
    canonicalRepoRef: "main",
    lastScanFingerprint: "scan-1",
    lastImportedAt: null,
    lastExportedAt: null,
    manifestVersion: 2,
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
    remoteLink: null,
  };
}

describe("buildImportPlan", () => {
  it("reuses prior manifest ids for stable identity and idempotent sync updates", () => {
    const state = makeState();
    state.importedAgents = [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-agent-old",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentName: "Researcher",
      lastImportedAt: importedAt,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }];

    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: state,
      existingAgents: [{
        id: "agent-1",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "openai/gpt-5.4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-agent-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: "Lead researcher",
            repoRelPath: ".opencode/agents/researcher.md",
            instructionsMarkdown: "# Researcher\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-agent-new",
            frontmatter: { model: null },
          }],
      },
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.skillUpserts).toEqual([]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({
        operation: "update",
        paperclipAgentId: "agent-1",
        matchBasis: "manifest_link",
        payload: expect.objectContaining({
          adapterType: "opencode_full",
          reportsTo: null,
          adapterConfig: expect.objectContaining({
            executionMode: "local_cli",
            model: "openai/gpt-5.4",
            promptTemplate: "# Researcher\n",
            timeoutSec: 120,
            connectTimeoutSec: 10,
            eventStreamIdleTimeoutSec: 30,
            failFastWhenUnavailable: true,
            localCli: expect.objectContaining({
              command: "opencode",
              allowProjectConfig: true,
              dangerouslySkipPermissions: false,
              graceSec: 5,
              env: {},
            }),
          }),
          metadata: expect.objectContaining({
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            repoRoot,
            repoRelPath: ".opencode/agents/researcher.md",
            workspaceId,
            projectId,
          }),
        }),
      }),
    ]);
  });

  it("surfaces discovery conflicts and unresolved desired skill warnings", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["missing", "researcher"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [{
          code: "invalid_repo_file",
          message: "Repo-root opencode.json exists but could not be parsed as a JSON object.",
          repoRelPath: "opencode.json",
          entityType: "workspace",
          entityKey: null,
        }],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-agent",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "invalid_selection", entityKey: "missing" }),
    ]);
    expect(plan.warnings).toEqual([
      "Repo-root opencode.json exists but could not be parsed as a JSON object.",
    ]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({ externalAgentKey: "researcher" }),
    ]);
  });

  it("updates metadata-linked managed agents but never adopts unmanaged lookalikes", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher", "writer"],
      importedAt,
      existingState: makeState(),
      existingAgents: [
        {
          id: "agent-managed",
          name: "Researcher",
          title: "Lead researcher",
          reportsTo: null,
          adapterType: "opencode_full",
          adapterConfig: { model: "openai/gpt-5.4" },
          metadata: {
            syncManaged: true,
            sourceSystem: "opencode_project_repo",
            syncPolicyMode: "top_level_agents_only",
            sourceOfTruth: "repo_first",
            projectId,
            workspaceId,
            repoRoot,
            repoRelPath: ".opencode/agents/researcher.md",
            canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
            externalAgentKey: "researcher",
            externalAgentName: "Researcher",
            importRole: "facade_entrypoint",
            topLevelAgent: true,
            lastImportedFingerprint: "fp-agent-old",
            lastImportedAt: importedAt,
            lastExportedFingerprint: null,
            lastExportedAt: null,
          },
        },
        {
          id: "agent-unmanaged",
          name: "Writer",
          title: "Writer",
          reportsTo: null,
          adapterType: "opencode_full",
          adapterConfig: { promptTemplate: "# Writer\n" },
          metadata: null,
        },
      ],
      discovery: {
        warnings: [],
        eligibleAgents: [
          {
            externalAgentKey: "researcher",
            displayName: "Researcher",
            role: "Lead researcher",
            repoRelPath: ".opencode/agents/researcher.md",
            instructionsMarkdown: "# Researcher\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-agent-new",
            frontmatter: { model: null },
          },
          {
            externalAgentKey: "writer",
            displayName: "Writer",
            role: "Writer",
            repoRelPath: ".opencode/agents/writer.md",
            instructionsMarkdown: "# Writer\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-writer",
            frontmatter: { model: null },
          },
        ],
      },
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.agentUpserts).toEqual([
      expect.objectContaining({ externalAgentKey: "researcher", operation: "update", paperclipAgentId: "agent-managed", matchBasis: "metadata_link" }),
      expect.objectContaining({ externalAgentKey: "writer", operation: "create", paperclipAgentId: null, matchBasis: "new_agent" }),
    ]);
  });

  it("writes adapter-safe linked_project_context linkRef for imported remote agents", () => {
    const state = makeState();
    state.remoteLink = {
      version: 2,
      status: "linked",
      baseUrl: "https://remote.example.com",
      serverScope: "shared",
      targetMode: "linked_project_context",
      canonicalWorkspaceId: workspaceId,
      canonicalRepoRoot: repoRoot,
      linkedDirectoryHint: "/remote/repo",
      projectEvidence: {
        projectId: "remote-project",
        projectName: "Remote Forgebox",
        pathCwd: "/remote/repo",
        repoRoot: "/remote/repo",
        repoUrl: "https://example.com/acme/repo.git",
        repoRef: "main",
      },
      validatedAt: "2026-04-16T12:00:00.000Z",
      invalidatedAt: null,
      invalidReason: null,
      lastHealthOkAt: "2026-04-16T12:00:00.000Z",
      lastSyncAt: null,
      lastRunAt: null,
      propagatedToImportedAgentsAt: null,
    };

    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: state,
      existingAgents: [{
        id: "agent-remote",
        name: "Researcher",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "openai/gpt-5.4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/researcher.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
          externalAgentKey: "researcher",
          externalAgentName: "Researcher",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-agent-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: "Lead researcher",
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-agent-new",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts).toHaveLength(1);
    expect(plan.agentUpserts[0]?.payload.adapterConfig).toEqual(expect.objectContaining({
      executionMode: "remote_server",
      remoteServer: expect.objectContaining({
        baseUrl: "https://remote.example.com",
        projectTarget: { mode: "linked_project_context" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: workspaceId,
          linkedDirectoryHint: "/remote/repo",
          serverScope: "shared",
          validatedAt: "2026-04-16T12:00:00.000Z",
        },
      }),
    }));
    expect((plan.agentUpserts[0]?.payload.adapterConfig as { remoteServer?: { linkRef?: Record<string, unknown> } }).remoteServer?.linkRef).not.toHaveProperty("projectEvidence");
    expect((plan.agentUpserts[0]?.payload.adapterConfig as { remoteServer?: { linkRef?: Record<string, unknown> } }).remoteServer?.linkRef).not.toHaveProperty("baseUrl");
  });

  it("emits paperclip_entity_drift for manifest-linked provenance mismatch", () => {
    const state = makeState();
    state.importedAgents = [{
      paperclipAgentId: "agent-1",
      externalAgentKey: "researcher",
      repoRelPath: ".opencode/agents/researcher.md",
      fingerprint: "fp-old",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentName: "Researcher",
      lastImportedAt: importedAt,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    }];

    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: state,
        existingAgents: [{
          id: "agent-1",
          name: "Researcher",
          title: null,
          reportsTo: null,
          adapterType: "opencode_full",
          adapterConfig: {},
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/other.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/other.md`,
          externalAgentKey: "other",
          externalAgentName: "Other",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
            repoRelPath: ".opencode/agents/researcher.md",
            instructionsMarkdown: "# Researcher\n",
            advisoryMode: null,
            selectionDefault: false,
            fingerprint: "fp-new",
            frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift", entityKey: "agent-1" }),
    ]);
  });

  it("emits paperclip_entity_drift for duplicate metadata-linked managed agents", () => {
    const managedMetadata = {
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      syncPolicyMode: "top_level_agents_only",
      sourceOfTruth: "repo_first",
      projectId,
      workspaceId,
      repoRoot,
      repoRelPath: ".opencode/agents/researcher.md",
      canonicalLocator: `${repoRoot}::.opencode/agents/researcher.md`,
      externalAgentKey: "researcher",
      externalAgentName: "Researcher",
      importRole: "facade_entrypoint",
      topLevelAgent: true,
      lastImportedFingerprint: "fp-old",
      lastImportedAt: importedAt,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    };
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["researcher"],
      importedAt,
      existingState: makeState(),
      existingAgents: [
        { id: "agent-1", name: "Researcher", title: null, reportsTo: null, adapterType: "opencode_full", adapterConfig: {}, metadata: managedMetadata },
        { id: "agent-2", name: "Researcher Duplicate", title: null, reportsTo: null, adapterType: "opencode_full", adapterConfig: {}, metadata: managedMetadata },
      ],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "researcher",
          displayName: "Researcher",
          role: null,
          repoRelPath: ".opencode/agents/researcher.md",
          instructionsMarkdown: "# Researcher\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-new",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ code: "paperclip_entity_drift", entityKey: "researcher" }),
    ]);
  });

  it("uses declared frontmatter model for new imported agents", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: "openai/gpt-5.4" },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe("openai/gpt-5.4");
  });

  it("uses a valid declared frontmatter model over an existing saved model on update", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [{
        id: "agent-1",
        name: "Orchestrator",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "anthropic/claude-sonnet-4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/orchestrator.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/orchestrator.md`,
          externalAgentKey: "orchestrator",
          externalAgentName: "Orchestrator",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: "openai/gpt-5.4" },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe("openai/gpt-5.4");
  });

  it("falls back to shared default model when frontmatter model is absent", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe(DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL);
  });

  it("preserves an existing saved model on resync when frontmatter model is absent", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [{
        id: "agent-1",
        name: "Orchestrator",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "anthropic/claude-sonnet-4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/orchestrator.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/orchestrator.md`,
          externalAgentKey: "orchestrator",
          externalAgentName: "Orchestrator",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-new",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe("anthropic/claude-sonnet-4");
  });

  it("preserves an existing valid saved model when declared model is invalid and ignored", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [{
        id: "agent-1",
        name: "Orchestrator",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "anthropic/claude-sonnet-4" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/orchestrator.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/orchestrator.md`,
          externalAgentKey: "orchestrator",
          externalAgentName: "Orchestrator",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [{
          code: "invalid_frontmatter_field",
          message: ".opencode/agents/orchestrator.md: Frontmatter field 'model' must use provider/model format; the declared value will be ignored during sync.",
          repoRelPath: ".opencode/agents/orchestrator.md",
          entityType: "agent",
          entityKey: "orchestrator",
        }],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe("anthropic/claude-sonnet-4");
  });

  it("falls back to the shared default when the existing saved model is invalid and no declared model is present", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [{
        id: "agent-1",
        name: "Orchestrator",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: { model: "invalidmodel" },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/orchestrator.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/orchestrator.md`,
          externalAgentKey: "orchestrator",
          externalAgentName: "Orchestrator",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe(DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL);
  });

  it("warns and falls back when model frontmatter is invalid", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [{
          code: "invalid_frontmatter_field",
          message: ".opencode/agents/orchestrator.md: Frontmatter field 'model' must use provider/model format; the declared value will be ignored during sync.",
          repoRelPath: ".opencode/agents/orchestrator.md",
          entityType: "agent",
          entityKey: "orchestrator",
        }],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.warnings).toContain(".opencode/agents/orchestrator.md: Frontmatter field 'model' must use provider/model format; the declared value will be ignored during sync.");
    expect(plan.agentUpserts[0]?.payload.adapterConfig.model).toBe(DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL);
  });

  it("preserves shared opencode_full remote config without making runtime baseUrl identity", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [{
        id: "agent-1",
        name: "Orchestrator",
        title: null,
        reportsTo: null,
        adapterType: "opencode_full",
        adapterConfig: {
          executionMode: "remote_server",
          model: "openai/gpt-5.4",
          remoteServer: {
            baseUrl: "https://example.com/opencode",
            auth: { mode: "none" },
            projectTarget: { mode: "fixed_path", projectPath: "/tmp/old" },
          },
        },
        metadata: {
          syncManaged: true,
          sourceSystem: "opencode_project_repo",
          syncPolicyMode: "top_level_agents_only",
          sourceOfTruth: "repo_first",
          projectId,
          workspaceId,
          repoRoot,
          repoRelPath: ".opencode/agents/orchestrator.md",
          canonicalLocator: `${repoRoot}::.opencode/agents/orchestrator.md`,
          externalAgentKey: "orchestrator",
          externalAgentName: "Orchestrator",
          importRole: "facade_entrypoint",
          topLevelAgent: true,
          lastImportedFingerprint: "fp-old",
          lastImportedAt: importedAt,
          lastExportedFingerprint: null,
          lastExportedAt: null,
        },
      }],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        adapterType: "opencode_full",
        adapterConfig: expect.objectContaining({
          executionMode: "remote_server",
          model: "openai/gpt-5.4",
          promptTemplate: "# Orchestrator\n",
          timeoutSec: 120,
          connectTimeoutSec: 10,
          eventStreamIdleTimeoutSec: 30,
          failFastWhenUnavailable: true,
          remoteServer: expect.objectContaining({
            baseUrl: "https://example.com/opencode",
            auth: { mode: "none" },
            healthTimeoutSec: 10,
            requireHealthyServer: true,
            projectTarget: { mode: "server_default" },
          }),
        }),
      }),
    }));
  });

  it("hydrates full local_cli defaults for newly imported opencode_full agents", () => {
    const plan = buildImportPlan({
      companyId,
      projectId,
      workspaceId,
      repoRoot,
      sourceOfTruth: "repo_first",
      selectedAgentKeys: ["orchestrator"],
      importedAt,
      existingState: makeState(),
      existingAgents: [],
      discovery: {
        warnings: [],
        eligibleAgents: [{
          externalAgentKey: "orchestrator",
          displayName: "Orchestrator",
          role: null,
          repoRelPath: ".opencode/agents/orchestrator.md",
          instructionsMarkdown: "# Orchestrator\n",
          advisoryMode: null,
          selectionDefault: false,
          fingerprint: "fp-orchestrator",
          frontmatter: { model: null },
        }],
      },
    });

    expect(plan.agentUpserts[0]?.payload.adapterConfig).toEqual({
      executionMode: "local_cli",
      model: DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL,
      promptTemplate: "# Orchestrator\n",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      localCli: {
        command: "opencode",
        allowProjectConfig: true,
        dangerouslySkipPermissions: false,
        graceSec: 5,
        env: {},
      },
    });
  });
});

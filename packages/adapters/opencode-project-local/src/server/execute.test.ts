import { describe, expect, it } from "vitest";
import { resolveProjectExecutionContext } from "./execute.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const canonicalWorkspaceId = "22222222-2222-4222-8222-222222222222";
const worktreeWorkspaceId = "33333333-3333-4333-8333-333333333333";

function makeInput(overrides: Partial<Parameters<typeof resolveProjectExecutionContext>[0]> = {}) {
  return {
    agent: { id: "agent-1", companyId: "company-1" },
    config: {},
    context: {},
    metadata: {
      syncManaged: true,
      sourceSystem: "opencode_project_repo",
      sourceOfTruth: "repo_first",
      projectId,
      workspaceId: canonicalWorkspaceId,
      repoRoot: "/repos/canonical",
      repoRelPath: ".opencode/agents/researcher.md",
      canonicalLocator: "/repos/canonical::.opencode/agents/researcher.md",
      externalAgentKey: "researcher",
      externalAgentName: "Researcher",
      folderPath: null,
      hierarchyMode: "metadata_only",
      reportsToExternalKey: null,
      lastImportedFingerprint: null,
      lastImportedAt: null,
      lastExportedFingerprint: null,
      lastExportedAt: null,
    },
    ...overrides,
  };
}

describe("resolveProjectExecutionContext", () => {
  it("prefers the resolved execution worktree cwd and warns when canonical differs", () => {
    const result = resolveProjectExecutionContext(makeInput({
      context: {
        paperclipWorkspace: {
          workspaceId: worktreeWorkspaceId,
          cwd: "/repos/worktree/issue-7",
          strategy: "git_worktree",
          source: "issue_workspace",
          worktreePath: "/repos/worktree/issue-7",
          repoUrl: "https://example.com/acme/repo.git",
          repoRef: "feature/issue-7",
        },
        paperclipWorkspaces: [{
          workspaceId: canonicalWorkspaceId,
          cwd: "/repos/canonical",
          repoUrl: "https://example.com/acme/repo.git",
          repoRef: "main",
        }],
      },
    }));

    expect(result).toMatchObject({
      cwd: "/repos/worktree/issue-7",
      canonicalWorkspaceId,
      canonicalWorkspaceCwd: "/repos/canonical",
      executionWorkspaceId: worktreeWorkspaceId,
      executionWorkspaceSource: "git_worktree",
      repoUrl: "https://example.com/acme/repo.git",
      repoRef: "feature/issue-7",
      allowProjectConfig: true,
    });
    expect(result.warnings[0]).toContain('/repos/canonical');
    expect(result.warnings[0]).toContain('/repos/worktree/issue-7');
  });

  it("fails closed when canonicalWorkspaceOnly is enabled without canonical metadata", () => {
    expect(() => resolveProjectExecutionContext({
      agent: { id: "agent-1", companyId: "company-1" },
      config: { canonicalWorkspaceOnly: true },
      context: {
        paperclipWorkspace: {
          workspaceId: worktreeWorkspaceId,
          cwd: "/repos/worktree/issue-7",
          strategy: "git_worktree",
        },
      },
      metadata: null,
    })).toThrow(/canonical project workspace metadata\/cwd is unavailable/i);
  });

  it("overrides execution back to canonical workspace when canonicalWorkspaceOnly is enabled", () => {
    const result = resolveProjectExecutionContext(makeInput({
      config: { canonicalWorkspaceOnly: true },
      context: {
        paperclipWorkspace: {
          workspaceId: worktreeWorkspaceId,
          cwd: "/repos/worktree/issue-7",
          strategy: "git_worktree",
          source: "issue_workspace",
          repoUrl: "https://example.com/acme/repo.git",
          repoRef: "feature/issue-7",
        },
        paperclipWorkspaces: [{
          workspaceId: canonicalWorkspaceId,
          cwd: "/repos/canonical",
          repoUrl: "https://example.com/acme/repo.git",
          repoRef: "main",
        }],
      },
    }));

    expect(result).toMatchObject({
      cwd: "/repos/canonical",
      canonicalWorkspaceId,
      canonicalWorkspaceCwd: "/repos/canonical",
      executionWorkspaceId: canonicalWorkspaceId,
      executionWorkspaceSource: "project_primary",
      repoRef: "main",
    });
    expect(result.warnings).toEqual([
      expect.stringContaining('overridden to canonical project workspace'),
    ]);
  });

  it("falls back to adapter cwd when host workspace is agent_home", () => {
    const result = resolveProjectExecutionContext(makeInput({
      config: { cwd: "/adapter/fallback" },
      context: {
        paperclipWorkspace: {
          workspaceId: worktreeWorkspaceId,
          cwd: "/ignored/agent-home",
          source: "agent_home",
          strategy: "project_primary",
        },
        paperclipWorkspaces: [{
          workspaceId: canonicalWorkspaceId,
          cwd: "/repos/canonical",
        }],
      },
    }));

    expect(result).toMatchObject({
      cwd: "/repos/canonical",
      executionWorkspaceSource: "adapter_fallback",
    });
  });
});

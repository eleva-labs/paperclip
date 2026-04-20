import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AdapterEnvironmentTestContext,
  AdapterExecutionContext,
} from "@paperclipai/adapter-utils";

const mocked = vi.hoisted(() => ({
  ensureCommandResolvable: vi.fn(),
  ensurePathInEnv: vi.fn((env: Record<string, string>) => env),
  discoverLocalCliOpenCodeModels: vi.fn(),
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: vi.fn(),
  prepareLocalCliRuntimeConfig: vi.fn(async () => ({
    env: {},
    cleanup: async () => {},
  })),
  checkRemoteServerHealth: vi.fn(),
  discoverRemoteServerOpenCodeModels: vi.fn(),
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: vi.fn(),
  createRemoteSession: vi.fn(),
  getRemoteSession: vi.fn(),
  getRemoteSessionMessages: vi.fn(),
  getRemoteSessionStatus: vi.fn(),
  postRemoteSessionMessage: vi.fn(),
  subscribeRemoteGlobalEvents: vi.fn(),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>("@paperclipai/adapter-utils/server-utils");
  return {
    ...actual,
    ensureCommandResolvable: mocked.ensureCommandResolvable,
    ensurePathInEnv: mocked.ensurePathInEnv,
  };
});

vi.mock("./local-models.js", () => ({
  discoverLocalCliOpenCodeModels: mocked.discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable: mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig: mocked.prepareLocalCliRuntimeConfig,
}));

vi.mock("./models.js", async () => {
  const actual = await vi.importActual<typeof import("./models.js")>("./models.js");
  return {
    ...actual,
    checkRemoteServerHealth: mocked.checkRemoteServerHealth,
  };
});

vi.mock("./remote-models.js", () => ({
  discoverRemoteServerOpenCodeModels: mocked.discoverRemoteServerOpenCodeModels,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable: mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
}));

vi.mock("./remote-client.js", async () => {
  const actual = await vi.importActual<typeof import("./remote-client.js")>("./remote-client.js");
  return {
    ...actual,
    createRemoteSession: mocked.createRemoteSession,
    getRemoteSession: mocked.getRemoteSession,
    getRemoteSessionMessages: mocked.getRemoteSessionMessages,
    getRemoteSessionStatus: mocked.getRemoteSessionStatus,
    postRemoteSessionMessage: mocked.postRemoteSessionMessage,
    subscribeRemoteGlobalEvents: mocked.subscribeRemoteGlobalEvents,
  };
});

import { getOpencodeFullConfigSchema, opencodeFullPersistedConfigSchema } from "./config-schema.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";
import { getRemoteSessionResumeDecision } from "./session-codec.js";

const localConfig = {
  executionMode: "local_cli" as const,
  model: "openai/gpt-5.4",
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
};

const remoteConfig = {
  executionMode: "remote_server" as const,
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  promptTemplate: "You are {{agent.id}}.",
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "none" as const },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const },
  },
};

function envCtx(config: unknown): AdapterEnvironmentTestContext {
  return { config } as AdapterEnvironmentTestContext;
}

function execCtx(
  config: unknown,
  onLog: AdapterExecutionContext["onLog"] = vi.fn(async () => {}),
  runtimeOverrides: AdapterExecutionContext["runtime"] | null = null,
): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      name: "Agent 1",
      companyId: "company-1",
      adapterType: "opencode_full",
      adapterConfig: {},
    },
    runtime: runtimeOverrides ?? { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config,
    context: {},
    onLog,
    onMeta: vi.fn(async () => {}),
    onSpawn: vi.fn(async () => {}),
    authToken: null,
  } as unknown as AdapterExecutionContext;
}

describe("opencode_full integration boundaries", () => {
  afterEach(() => {
    Object.values(mocked).forEach((fn) => fn.mockReset());
    mocked.ensurePathInEnv.mockImplementation((env: Record<string, string>) => env);
    mocked.prepareLocalCliRuntimeConfig.mockResolvedValue({ env: {}, cleanup: async () => {} });
    // Default streaming subscription mock: resolves connected immediately
    mocked.subscribeRemoteGlobalEvents.mockResolvedValue({
      connected: Promise.resolve(),
      done: new Promise<void>(() => {}),
      close: vi.fn(async () => {}),
      droppedEvents: () => 0,
    });
  });

  it("keeps schema/UI contract MVP-narrow", () => {
    const schema = getOpencodeFullConfigSchema();
    const executionModeField = schema.fields.find((field) => field.key === "executionMode");
    expect(executionModeField?.options?.map((option) => option.value)).toEqual([
      "local_cli",
      "remote_server",
      "local_sdk",
    ]);

    expect(opencodeFullPersistedConfigSchema.safeParse({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        projectTarget: { mode: "paperclip_workspace" },
      },
    }).success).toBe(false);
  });

  it("runs a config-only local environment check through the shared boundary", async () => {
    mocked.ensureCommandResolvable.mockResolvedValue(undefined);
    mocked.discoverLocalCliOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureLocalCliOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testEnvironment(envCtx(localConfig));

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "opencode_full_config_valid",
        detail: expect.stringContaining("does not claim workspace-aware runtime readiness"),
      }),
      expect.objectContaining({ code: "opencode_local_cli_command_found" }),
      expect.objectContaining({ code: "opencode_local_cli_model_valid" }),
    ]));
  });

  it("runs a config-only remote server_default environment check through the shared boundary", async () => {
    mocked.checkRemoteServerHealth.mockResolvedValue({
      ok: true,
      status: 200,
      message: "Remote server health check succeeded.",
      detail: "GET /global/health responded.",
    });
    mocked.discoverRemoteServerOpenCodeModels.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);

    const result = await testEnvironment(envCtx(remoteConfig));

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "opencode_full_config_valid",
        detail: expect.stringContaining("does not claim workspace-aware runtime readiness"),
      }),
      expect.objectContaining({ code: "opencode_remote_server_reachable" }),
      expect.objectContaining({ code: "opencode_remote_model_valid" }),
    ]));
  });

  it("executes the canonical remote session flow through the shared execute entrypoint", async () => {
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-1" } });
    mocked.postRemoteSessionMessage.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: {
        info: { cost: 0.12, usage: { inputTokens: 4, outputTokens: 9 } },
        parts: [{ text: "hello from remote" }],
      },
    });
    mocked.getRemoteSessionMessages.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: [{ parts: [{ text: "hello from remote" }] }],
    });

    const result = await execute(execCtx(remoteConfig));

    expect(mocked.createRemoteSession).toHaveBeenCalledOnce();
    expect(mocked.postRemoteSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: "remote_server",
        remoteServer: expect.objectContaining({
          baseUrl: "https://opencode.example.com",
          projectTarget: expect.objectContaining({ mode: "server_default" }),
        }),
      }),
      "ses-1",
      expect.objectContaining({
        model: { providerID: "openai", modelID: "gpt-5.4" },
      }),
    );
    expect(mocked.getRemoteSessionMessages).toHaveBeenCalledWith(
      expect.objectContaining({ executionMode: "remote_server" }),
      "ses-1",
    );
    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "ses-1",
      sessionDisplayId: "ses-1",
      summary: "hello from remote",
      sessionParams: {
        executionMode: "remote_server",
        baseUrl: "https://opencode.example.com",
        projectTargetMode: "server_default",
        resolvedTargetIdentity: "server_default",
      },
    });
  });

  it("executes linked-project remote flow with directory hints and falls back fresh on stale session metadata", async () => {
    const linkedConfig = {
      ...remoteConfig,
      remoteServer: {
        ...remoteConfig.remoteServer,
        projectTarget: { mode: "linked_project_context" as const },
        linkRef: {
          mode: "linked_project_context" as const,
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/srv/repos/forgebox",
          serverScope: "shared" as const,
          validatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    };
    mocked.ensureRemoteServerOpenCodeModelConfiguredAndAvailable.mockResolvedValue([{ id: "openai/gpt-5.4", label: "openai/gpt-5.4" }]);
    mocked.createRemoteSession.mockResolvedValue({ ok: true, status: 200, text: "", data: { id: "ses-linked" } });
    mocked.postRemoteSessionMessage.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: {
        info: { cost: 0.12, usage: { inputTokens: 4, outputTokens: 9 } },
        parts: [{ text: "hello from linked remote" }],
      },
    });
    mocked.getRemoteSessionMessages.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: [{ parts: [{ text: "hello from linked remote" }] }],
    });

    const onLog = vi.fn(async () => {});
    const staleRuntime = {
      sessionId: "ses-old",
      sessionDisplayId: "ses-old",
      taskKey: null,
      sessionParams: {
        executionMode: "remote_server",
        sessionId: "ses-old",
        remoteSessionId: "ses-old",
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "opencode_full",
        configFingerprint: "bad-fingerprint",
        baseUrl: "https://opencode.example.com",
        projectTargetMode: "linked_project_context",
        resolvedTargetIdentity: "linked_project_context:11111111-1111-4111-8111-111111111111:/srv/repos/other",
        canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
        linkedDirectoryHint: "/srv/repos/other",
      },
    };

    expect(getRemoteSessionResumeDecision({
      companyId: "company-1",
      agentId: "agent-1",
      config: linkedConfig,
      sessionParams: staleRuntime.sessionParams,
    })).toEqual({ shouldResume: false, reason: "config_fingerprint_mismatch" });

    const result = await execute(execCtx(linkedConfig, onLog, staleRuntime));

    expect(mocked.createRemoteSession).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteServer: expect.objectContaining({
          projectTarget: { mode: "linked_project_context" },
          linkRef: expect.objectContaining({ linkedDirectoryHint: "/srv/repos/forgebox" }),
        }),
      }),
      {},
    );
    expect(mocked.postRemoteSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteServer: expect.objectContaining({
          projectTarget: { mode: "linked_project_context" },
          linkRef: expect.objectContaining({ linkedDirectoryHint: "/srv/repos/forgebox" }),
        }),
      }),
      "ses-linked",
      expect.objectContaining({
        model: { providerID: "openai", modelID: "gpt-5.4" },
      }),
    );
    expect(result).toMatchObject({
      exitCode: 0,
      sessionId: "ses-linked",
      summary: "hello from linked remote",
      sessionParams: {
        executionMode: "remote_server",
        baseUrl: "https://opencode.example.com",
        projectTargetMode: "linked_project_context",
        resolvedTargetIdentity: "linked_project_context:11111111-1111-4111-8111-111111111111:/srv/repos/forgebox",
        canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
        linkedDirectoryHint: "/srv/repos/forgebox",
      },
    });
    expect(onLog).toHaveBeenCalledWith("stdout", expect.stringContaining("Remote session resume refused"));
  });

  it("does not claim non-none auth execution support", async () => {
    const result = await execute(execCtx({
      ...remoteConfig,
      remoteServer: {
        ...remoteConfig.remoteServer,
        auth: { mode: "bearer", token: "resolved-token" },
      },
    }));

    expect(result).toMatchObject({
      exitCode: 1,
      errorCode: "AUTH_UNRESOLVED",
    });
  });
});

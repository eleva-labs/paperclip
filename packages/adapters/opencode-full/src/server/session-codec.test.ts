import { describe, expect, it } from "vitest";
import {
  canResumeRemoteSession,
  createRemoteSessionParams,
  getConfigFingerprint,
  getRemoteSessionResumeDecision,
  sessionCodec,
  shouldStartFreshRemoteSession,
} from "./session-codec.js";

const baseConfig = {
  executionMode: "remote_server",
  model: "openai/gpt-5.4",
  variant: "medium",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "bearer", token: "resolved-token" },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default", requireDedicatedServer: false },
  },
};

describe("opencodeFull session codec and isolation", () => {
  it("produces a deterministic config fingerprint from resolved runtime fields", () => {
    const fingerprintA = getConfigFingerprint(baseConfig);
    const fingerprintB = getConfigFingerprint({
      ...baseConfig,
      remoteServer: {
        ...baseConfig.remoteServer,
        projectTarget: { requireDedicatedServer: false, mode: "server_default" },
      },
    });

    expect(fingerprintA).toBe(fingerprintB);
    expect(getConfigFingerprint({
      ...baseConfig,
      remoteServer: { ...baseConfig.remoteServer, baseUrl: "https://other.example.com" },
    })).not.toBe(fingerprintA);
    expect(getConfigFingerprint({
      ...baseConfig,
      remoteServer: { ...baseConfig.remoteServer, auth: { mode: "bearer", token: "other-token" } },
    })).not.toBe(fingerprintA);
  });

  it("serializes and deserializes remote session params", () => {
    const session = createRemoteSessionParams({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      remoteSessionId: "remote-session-1",
      canonicalWorkspaceId: "workspace-1",
      canonicalWorkspaceCwd: "/repo",
      createdAt: "2026-04-11T12:00:00.000Z",
    });

    const serialized = sessionCodec.serialize(session);
    expect(serialized).toEqual(session);
    expect(sessionCodec.deserialize(serialized)).toEqual(session);
    expect(sessionCodec.getDisplayId(serialized)).toBe("remote-session-1");
  });

  it("requires exact ownership, config fingerprint, base URL, target mode, and resolved target identity for resume", () => {
    const session = createRemoteSessionParams({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      remoteSessionId: "remote-session-1",
      createdAt: "2026-04-11T12:00:00.000Z",
    });

    expect(canResumeRemoteSession({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      sessionParams: session,
    })).toEqual({ ok: true });

    expect(canResumeRemoteSession({
      companyId: "company-2",
      agentId: "agent-1",
      config: baseConfig,
      sessionParams: session,
    })).toEqual({ ok: false, reason: "company_id_mismatch" });

    expect(canResumeRemoteSession({
      companyId: "company-1",
      agentId: "agent-1",
      config: { ...baseConfig, remoteServer: { ...baseConfig.remoteServer, baseUrl: "https://changed.example.com" } },
      sessionParams: session,
    })).toEqual({ ok: false, reason: "config_fingerprint_mismatch" });

    expect(canResumeRemoteSession({
      companyId: "company-1",
      agentId: "agent-1",
      config: {
        ...baseConfig,
        remoteServer: {
          ...baseConfig.remoteServer,
          projectTarget: {
            mode: "server_managed_namespace",
            namespaceTemplate: "company/{companyId}",
            requireDedicatedServer: false,
          },
        },
      },
      sessionParams: session,
    })).toEqual({ ok: false, reason: "TARGET_MODE_REQUIRES_SERVER_ISOLATION_PROOF" });
  });

  it("returns a resume decision helper that forces fresh remote sessions on gating changes", () => {
    const session = createRemoteSessionParams({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      remoteSessionId: "remote-session-1",
    });

    expect(getRemoteSessionResumeDecision({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      sessionParams: session,
    })).toEqual({ shouldResume: true, reason: null });

    expect(getRemoteSessionResumeDecision({
      companyId: "company-1",
      agentId: "agent-1",
      config: {
        ...baseConfig,
        remoteServer: { ...baseConfig.remoteServer, auth: { mode: "bearer", token: "different-token" } },
      },
      sessionParams: session,
    })).toEqual({ shouldResume: false, reason: "config_fingerprint_mismatch" });

    expect(shouldStartFreshRemoteSession({
      companyId: "company-1",
      agentId: "agent-1",
      config: {
        ...baseConfig,
        remoteServer: { ...baseConfig.remoteServer, auth: { mode: "bearer", token: "different-token" } },
      },
      sessionParams: session,
    })).toBe(true);
  });
});

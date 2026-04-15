import { describe, expect, it } from "vitest";
import {
  canResumeRemoteSession,
  createRemoteSessionParams,
  getConfigFingerprint,
  getRemoteSessionResumeDecision,
  opencodeFullSessionParamsSchema,
  sessionCodec,
  shouldStartFreshRemoteSession,
} from "./session-codec.js";
import { parseOpencodeFullExecutionResult } from "./result-schema.js";

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
    projectTarget: { mode: "server_default" },
  },
};

describe("opencodeFull session codec and isolation", () => {
  it("produces a deterministic config fingerprint from resolved runtime fields", () => {
    const fingerprintA = getConfigFingerprint(baseConfig);
    const fingerprintB = getConfigFingerprint({
      ...baseConfig,
      remoteServer: {
        ...baseConfig.remoteServer,
        projectTarget: { mode: "server_default" },
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
    expect(fingerprintA).not.toContain("resolved-token");
    expect(fingerprintA).not.toContain("opencode.example.com");
  });

  it("serializes and deserializes remote session params", () => {
    const session = createRemoteSessionParams({
      companyId: "company-1",
      agentId: "agent-1",
      config: baseConfig,
      remoteSessionId: "remote-session-1",
    });

    const serialized = sessionCodec.serialize(session);
    expect(serialized).toEqual(session);
    expect(sessionCodec.deserialize(serialized)).toEqual(session);
    expect(sessionCodec.getDisplayId(serialized)).toBe("remote-session-1");
    expect(opencodeFullSessionParamsSchema.parse(session)).toEqual({
      executionMode: "remote_server",
      sessionId: "remote-session-1",
      remoteSessionId: "remote-session-1",
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "opencode_full",
      configFingerprint: getConfigFingerprint(baseConfig),
      ownership: {
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "opencode_full",
        executionMode: "remote_server",
        configFingerprint: getConfigFingerprint(baseConfig),
      },
      baseUrl: "https://opencode.example.com",
      projectTargetMode: "server_default",
      resolvedTargetIdentity: "server-default",
    });
    expect(session.configFingerprint).not.toContain("resolved-token");
  });

  it("deserializes a pre-cycle-1.1 legacy remote session payload", () => {
    expect(sessionCodec.deserialize({
      remoteSessionId: "legacy-remote-session-1",
      ownership: {
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "opencode_full",
        executionMode: "remote_server",
        configFingerprint: "legacy-fingerprint",
      },
      baseUrl: "https://opencode.example.com",
      projectTargetMode: "server_default",
      resolvedTargetIdentity: "server-default",
    })).toEqual({
      executionMode: "remote_server",
      sessionId: "legacy-remote-session-1",
      remoteSessionId: "legacy-remote-session-1",
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "opencode_full",
      configFingerprint: "legacy-fingerprint",
      ownership: {
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "opencode_full",
        executionMode: "remote_server",
        configFingerprint: "legacy-fingerprint",
      },
      baseUrl: "https://opencode.example.com",
      projectTargetMode: "server_default",
      resolvedTargetIdentity: "server-default",
    });
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
    })).toEqual({ ok: false, reason: "base_url_mismatch" });

    expect(canResumeRemoteSession({
      companyId: "company-1",
      agentId: "agent-1",
      config: {
        ...baseConfig,
        model: "openai/gpt-5.2",
      },
      sessionParams: session,
    })).toEqual({ ok: false, reason: "config_fingerprint_mismatch" });
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

  it("normalizes legacy execution errors into approved result families", () => {
    expect(parseOpencodeFullExecutionResult({
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "REMOTE_AUTH_REJECTED",
      errorMessage: "Remote server rejected authentication.",
      sessionParams: null,
      sessionDisplayId: null,
      summary: null,
    }).errorCode).toBe("AUTH_REJECTED");

    expect(parseOpencodeFullExecutionResult({
      exitCode: 1,
      signal: null,
      timedOut: true,
      errorCode: "REMOTE_TIMEOUT",
      errorMessage: "Remote execution timed out.",
      sessionParams: null,
      sessionDisplayId: null,
      summary: null,
    }).errorCode).toBe("TIMEOUT");
  });
});

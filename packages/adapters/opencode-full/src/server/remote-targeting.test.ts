import { describe, expect, it } from "vitest";
import { isExecutableRemoteTarget, resolveLinkedRemoteTarget, resolveRemoteTargetIdentity } from "./remote-targeting.js";

describe("resolveRemoteTargetIdentity", () => {
  it("resolves server_default to a stable target identity", () => {
    expect(resolveRemoteTargetIdentity({
      mode: "server_default",
    })).toEqual({
      status: "resolved",
      targetMode: "server_default",
      resolvedTargetIdentity: "server_default",
      directoryQuery: null,
      message: "server_default is the safe baseline remote target identity for the current MVP remote mode.",
    });
  });

  it("requires runtime config to resolve linked_project_context", () => {
    expect(resolveRemoteTargetIdentity({
      mode: "linked_project_context",
    })).toMatchObject({
      status: "invalid",
      targetMode: "linked_project_context",
      code: "TARGET_LINK_REF_REQUIRED",
    });
  });

  it("resolves linked_project_context from runtime link metadata", () => {
    expect(resolveLinkedRemoteTarget({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "linked_project_context" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "/tmp/forgebox",
          serverScope: "shared",
          validatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    })).toEqual({
      status: "resolved",
      targetMode: "linked_project_context",
      resolvedTargetIdentity: "linked_project_context:11111111-1111-4111-8111-111111111111:/tmp/forgebox",
      directoryQuery: "/tmp/forgebox",
      message: "linked_project_context resolves to the plugin-derived linked directory hint for MVP write-path targeting.",
    });
  });

  it("rejects linked_project_context when runtime hint metadata is missing", () => {
    expect(resolveLinkedRemoteTarget({
      executionMode: "remote_server",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      remoteServer: {
        baseUrl: "https://opencode.example.com",
        auth: { mode: "none" },
        healthTimeoutSec: 10,
        requireHealthyServer: true,
        projectTarget: { mode: "linked_project_context" },
        linkRef: {
          mode: "linked_project_context",
          canonicalWorkspaceId: "11111111-1111-4111-8111-111111111111",
          linkedDirectoryHint: "   ",
          serverScope: "shared",
          validatedAt: "2026-04-16T00:00:00.000Z",
        },
      },
    } as never)).toMatchObject({
      status: "invalid",
      targetMode: "linked_project_context",
      code: "TARGET_LINK_MISSING_HINT",
    });
  });

  it("keeps executability aligned with supported MVP target modes", () => {
    expect(isExecutableRemoteTarget({ mode: "server_default" })).toBe(true);
    expect(isExecutableRemoteTarget({ mode: "linked_project_context" })).toBe(true);
  });
});

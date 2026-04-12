import { describe, expect, it } from "vitest";
import { resolveRemoteTargetIdentity } from "./remote-targeting.js";

describe("resolveRemoteTargetIdentity", () => {
  it("resolves server_default to a stable target identity", () => {
    expect(resolveRemoteTargetIdentity({
      mode: "server_default",
      requireDedicatedServer: false,
    })).toEqual({
      status: "resolved",
      targetMode: "server_default",
      resolvedTargetIdentity: "server-default",
      message: "Cycle 1.1 supports only the server_default remote target identity.",
    });
  });

  it("returns clear deferred or unsupported results for unproven target modes", () => {
    expect(resolveRemoteTargetIdentity({
      mode: "paperclip_workspace",
      requireDedicatedServer: false,
    })).toMatchObject({
      status: "conditional",
      targetMode: "paperclip_workspace",
      code: "TARGET_MODE_DEFERRED",
    });

    expect(resolveRemoteTargetIdentity({
      mode: "server_managed_namespace",
      namespaceTemplate: "company/{companyId}",
      requireDedicatedServer: false,
    })).toMatchObject({
      status: "conditional",
      targetMode: "server_managed_namespace",
      code: "TARGET_MODE_DEFERRED",
    });

    expect(resolveRemoteTargetIdentity({
      mode: "fixed_path",
      projectPath: "/srv/opencode/company-a",
      requireDedicatedServer: true,
    })).toMatchObject({
      status: "unsupported",
      targetMode: "fixed_path",
      code: "TARGET_MODE_UNSUPPORTED_IN_CYCLE_1_1",
    });
  });
});

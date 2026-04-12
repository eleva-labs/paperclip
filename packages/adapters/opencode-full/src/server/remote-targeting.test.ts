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
      message: "server_default is the safe baseline remote target identity proven in the Cycle 3.1 spike.",
    });
  });

  it("returns clear deferred or unsupported results for unproven target modes", () => {
    expect(resolveRemoteTargetIdentity({
      mode: "paperclip_workspace",
      requireDedicatedServer: false,
    })).toMatchObject({
      status: "conditional",
      targetMode: "paperclip_workspace",
      code: "TARGET_MODE_REQUIRES_RUNTIME_PROBE",
    });

    expect(resolveRemoteTargetIdentity({
      mode: "server_managed_namespace",
      namespaceTemplate: "company/{companyId}",
      requireDedicatedServer: false,
    })).toMatchObject({
      status: "conditional",
      targetMode: "server_managed_namespace",
      code: "TARGET_MODE_REQUIRES_SERVER_ISOLATION_PROOF",
    });

    expect(resolveRemoteTargetIdentity({
      mode: "fixed_path",
      projectPath: "/srv/opencode/company-a",
      requireDedicatedServer: true,
    })).toMatchObject({
      status: "conditional",
      targetMode: "fixed_path",
      code: "TARGET_MODE_REQUIRES_DEDICATED_SERVER",
    });

    expect(resolveRemoteTargetIdentity({
      mode: "fixed_path",
      projectPath: "/srv/opencode/shared",
      requireDedicatedServer: false,
    })).toMatchObject({
      status: "unsupported",
      targetMode: "fixed_path",
      code: "TARGET_MODE_UNSUPPORTED_SHARED_SERVER_PATH",
    });
  });
});

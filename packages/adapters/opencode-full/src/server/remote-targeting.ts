import type { OpencodeFullRemoteProjectTarget } from "./config-schema.js";
import { opencodeFullRemoteProjectTargetSchema } from "./config-schema.js";

export type RemoteTargetIdentityResolution =
  | {
      status: "resolved";
      targetMode: "server_default";
      resolvedTargetIdentity: "server-default";
      message: string;
    }
  | {
      status: "conditional";
      targetMode: "paperclip_workspace" | "server_managed_namespace" | "fixed_path";
      code:
        | "TARGET_MODE_REQUIRES_RUNTIME_PROBE"
        | "TARGET_MODE_REQUIRES_SERVER_ISOLATION_PROOF"
        | "TARGET_MODE_REQUIRES_DEDICATED_SERVER";
      message: string;
    }
  | {
      status: "unsupported";
      targetMode: "fixed_path";
      code: "TARGET_MODE_UNSUPPORTED_SHARED_SERVER_PATH";
      message: string;
    };

export function resolveRemoteTargetIdentity(rawTarget: unknown): RemoteTargetIdentityResolution {
  const target = opencodeFullRemoteProjectTargetSchema.parse(rawTarget);

  switch (target.mode) {
    case "server_default":
      return {
        status: "resolved",
        targetMode: "server_default",
        resolvedTargetIdentity: "server-default",
        message: "server_default is the safe baseline remote target identity proven in the Cycle 3.1 spike.",
      };
    case "paperclip_workspace":
      return {
        status: "conditional",
        targetMode: "paperclip_workspace",
        code: "TARGET_MODE_REQUIRES_RUNTIME_PROBE",
        message: "paperclip_workspace remains conditional until a separate workspace-aware runtime probe contract exists.",
      };
    case "server_managed_namespace":
      return {
        status: "conditional",
        targetMode: "server_managed_namespace",
        code: "TARGET_MODE_REQUIRES_SERVER_ISOLATION_PROOF",
        message: "server_managed_namespace remains conditional until server-side namespace isolation is proven safe.",
      };
    case "fixed_path":
      if (target.requireDedicatedServer) {
        return {
          status: "conditional",
          targetMode: "fixed_path",
          code: "TARGET_MODE_REQUIRES_DEDICATED_SERVER",
          message: "fixed_path remains conditional and requires a dedicated single-company server assertion before it can be considered safe.",
        };
      }

      return {
        status: "unsupported",
        targetMode: "fixed_path",
        code: "TARGET_MODE_UNSUPPORTED_SHARED_SERVER_PATH",
        message: "fixed_path is unsupported for shared/unknown-scope servers because path isolation is not proven safe.",
      };
  }

  return {
    status: "unsupported",
    targetMode: "fixed_path",
    code: "TARGET_MODE_UNSUPPORTED_SHARED_SERVER_PATH",
    message: "Unsupported remote target mode.",
  };
}

export function isRemoteTargetModeResolved(rawTarget: unknown): boolean {
  return resolveRemoteTargetIdentity(rawTarget).status === "resolved";
}

export function getRemoteTargetMode(rawTarget: unknown): OpencodeFullRemoteProjectTarget["mode"] {
  return opencodeFullRemoteProjectTargetSchema.parse(rawTarget).mode;
}

export function isExecutableRemoteTarget(rawTarget: unknown): boolean {
  return resolveRemoteTargetIdentity(rawTarget).status === "resolved";
}

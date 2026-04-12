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
      code: "TARGET_MODE_DEFERRED";
      message: string;
    }
  | {
      status: "unsupported";
      targetMode: "paperclip_workspace" | "server_managed_namespace" | "fixed_path";
      code: "TARGET_MODE_UNSUPPORTED_IN_CYCLE_1_1";
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
        message: "Cycle 1.1 supports only the server_default remote target identity.",
      };
    case "paperclip_workspace":
      return {
        status: "conditional",
        targetMode: "paperclip_workspace",
        code: "TARGET_MODE_DEFERRED",
        message: "paperclip_workspace remains deferred until a separate workspace-aware runtime probe contract exists.",
      };
    case "server_managed_namespace":
      return {
        status: "conditional",
        targetMode: "server_managed_namespace",
        code: "TARGET_MODE_DEFERRED",
        message: "server_managed_namespace remains conditional until server-isolated namespace proof exists.",
      };
    case "fixed_path":
      return {
        status: "unsupported",
        targetMode: "fixed_path",
        code: "TARGET_MODE_UNSUPPORTED_IN_CYCLE_1_1",
        message: "fixed_path is not supported in Cycle 1.1 because shared-server path isolation is not yet proven safe.",
      };
  }

  return {
    status: "unsupported",
    targetMode: "fixed_path",
    code: "TARGET_MODE_UNSUPPORTED_IN_CYCLE_1_1",
    message: "Unsupported remote target mode.",
  };
}

export function isRemoteTargetModeResolved(rawTarget: unknown): boolean {
  return resolveRemoteTargetIdentity(rawTarget).status === "resolved";
}

export function getRemoteTargetMode(rawTarget: unknown): OpencodeFullRemoteProjectTarget["mode"] {
  return opencodeFullRemoteProjectTargetSchema.parse(rawTarget).mode;
}

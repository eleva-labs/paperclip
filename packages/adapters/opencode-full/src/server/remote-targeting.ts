import type { OpencodeFullRemoteProjectTarget } from "./config-schema.js";
import { opencodeFullRemoteProjectTargetShapeSchema } from "./config-schema.js";
import type { OpencodeFullRemoteServerRuntimeConfig } from "./runtime-schema.js";

export type RemoteTargetIdentityResolution =
  | {
      status: "resolved";
      targetMode: "server_default" | "linked_project_context";
      resolvedTargetIdentity: string;
      directoryQuery: string | null;
      message: string;
    }
  | {
      status: "invalid";
      targetMode: "linked_project_context";
      code:
        | "TARGET_LINK_REF_REQUIRED"
        | "TARGET_LINK_MISSING_HINT";
      message: string;
    };

export function resolveLinkedRemoteTarget(config: OpencodeFullRemoteServerRuntimeConfig): RemoteTargetIdentityResolution {
  const target = opencodeFullRemoteProjectTargetShapeSchema.parse(config.remoteServer.projectTarget);

  switch (target.mode) {
    case "server_default":
      return {
        status: "resolved",
        targetMode: "server_default",
        resolvedTargetIdentity: "server_default",
        directoryQuery: null,
        message: "server_default is the safe baseline remote target identity for the current MVP remote mode.",
      };
    case "linked_project_context": {
      const linkRef = config.remoteServer.linkRef;
      if (!linkRef) {
        return {
          status: "invalid",
          targetMode: "linked_project_context",
          code: "TARGET_LINK_REF_REQUIRED",
          message: "linked_project_context requires plugin-derived linkRef runtime metadata.",
        };
      }
      if (!linkRef.linkedDirectoryHint.trim()) {
        return {
          status: "invalid",
          targetMode: "linked_project_context",
          code: "TARGET_LINK_MISSING_HINT",
          message: "linked_project_context requires a non-empty linked directory hint.",
        };
      }
      return {
        status: "resolved",
        targetMode: "linked_project_context",
        resolvedTargetIdentity: `linked_project_context:${linkRef.canonicalWorkspaceId}:${linkRef.linkedDirectoryHint}`,
        directoryQuery: linkRef.linkedDirectoryHint,
        message: "linked_project_context resolves to the plugin-derived linked directory hint for MVP write-path targeting.",
      };
    }
  }
}

export function resolveRemoteTargetIdentity(rawTarget: unknown): RemoteTargetIdentityResolution {
  const target = opencodeFullRemoteProjectTargetShapeSchema.parse(rawTarget);

  switch (target.mode) {
    case "server_default":
      return {
        status: "resolved",
        targetMode: "server_default",
        resolvedTargetIdentity: "server_default",
        directoryQuery: null,
        message: "server_default is the safe baseline remote target identity for the current MVP remote mode.",
      };
    case "linked_project_context":
      return {
        status: "invalid",
        targetMode: "linked_project_context",
        code: "TARGET_LINK_REF_REQUIRED",
        message: "linked_project_context requires full runtime config to resolve linked directory targeting.",
      };
  }
}

export function isRemoteTargetModeResolved(rawTarget: unknown): boolean {
  return opencodeFullRemoteProjectTargetShapeSchema.parse(rawTarget).mode === "server_default";
}

export function getRemoteTargetMode(rawTarget: unknown): OpencodeFullRemoteProjectTarget["mode"] {
  return opencodeFullRemoteProjectTargetShapeSchema.parse(rawTarget).mode;
}

export function isExecutableRemoteTarget(rawTarget: unknown): boolean {
  const mode = opencodeFullRemoteProjectTargetShapeSchema.parse(rawTarget).mode;
  return mode === "server_default" || mode === "linked_project_context";
}

import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const OPENCODE_PROJECT_SYNC_PLUGIN_ID = "paperclip-opencode-project";
export const OPENCODE_PROJECT_SYNC_TOOLBAR_BUTTON_ID = "opencode-project-toolbar";
export const OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID = "opencode-project-tab";
export const OPENCODE_PROJECT_SYNC_STATE_DATA_KEY = "project-sync-state";
export const OPENCODE_PROJECT_SYNC_PREVIEW_DATA_KEY = "project-sync-preview";
export const OPENCODE_PROJECT_SYNC_HOST_CONTRACT_DATA_KEY = "host-mutation-contract";
export const OPENCODE_PROJECT_BOOTSTRAP_ACTION_KEY = "bootstrap-project";
export const OPENCODE_PROJECT_SYNC_ACTION_KEY = "sync-now";
export const OPENCODE_PROJECT_SYNC_FINALIZE_ACTION_KEY = "finalize-sync-now";
export const OPENCODE_PROJECT_EXPORT_ACTION_KEY = "export-to-repo";
export const OPENCODE_PROJECT_TEST_RUNTIME_ACTION_KEY = "test-runtime";

const manifest: PaperclipPluginManifestV1 = {
  id: OPENCODE_PROJECT_SYNC_PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenCode Project Sync",
  description:
    "Foundation manifest for the project-scoped OpenCode bootstrap, sync-status, guarded export, and runtime test workflow.",
  author: "Paperclip",
  categories: ["workspace", "automation"],
  capabilities: [
    "projects.read",
    "project.workspaces.read",
    "agents.read",
    "plugin.state.read",
    "plugin.state.write",
    "activity.log.write",
    "http.outbound",
    "ui.sidebar.register",
    "ui.detailTab.register",
    "ui.action.register",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      hostMutationTransport: {
        type: "string",
        enum: ["paperclip_rest_api_v1"],
        default: "paperclip_rest_api_v1",
        description:
          "MVP mutations for imported agents and skills use the existing Paperclip /api surface instead of new plugin SDK mutation clients.",
      },
      workerHostApiBaseUrl: {
        type: "string",
        format: "uri",
        default: "http://127.0.0.1:3100/api",
        description:
          "Optional absolute /api base URL for future worker-side loopback HTTP mutations. UI same-origin requests remain the primary host surface.",
      },
      preferWorkerHttpMutations: {
        type: "boolean",
        default: false,
        description:
          "When false, the plugin UI applies import/export mutations through the operator's existing board session. When true, later worker code may call the same REST contract over HTTP.",
      },
    },
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "detailTab",
        id: OPENCODE_PROJECT_SYNC_DETAIL_TAB_ID,
        displayName: "OpenCode",
        exportName: "ProjectDetailTab",
        entityTypes: ["project"],
        order: 40,
      },
    ],
  },
};

export default manifest;

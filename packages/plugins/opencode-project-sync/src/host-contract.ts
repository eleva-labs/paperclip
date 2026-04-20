import { z } from "@paperclipai/plugin-sdk";
import {
  OPENCODE_PROJECT_HOST_API_BASE_PATH,
  OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS,
  OPENCODE_PROJECT_HOST_MUTATION_SURFACE,
  OPENCODE_PROJECT_HOST_MUTATION_TRANSPORT,
} from "./host-contract-constants.js";
import {
  OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY,
  OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY,
  OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY,
  OPENCODE_PROJECT_RESOLVE_REMOTE_MODE_STATUS_ACTION_KEY,
} from "./manifest.js";

export {
  OPENCODE_PROJECT_HOST_API_BASE_PATH,
  OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS,
  OPENCODE_PROJECT_HOST_MUTATION_SURFACE,
  OPENCODE_PROJECT_HOST_MUTATION_TRANSPORT,
};

/**
 * Cycle 1.1 freezes a realistic mutation boundary without inventing new host SDK
 * methods: the companion plugin plans sync/import/export in-package, then applies
 * Paperclip agent/skill mutations through the host's existing REST API contract.
 *
 * Supported MVP callers:
 * - Plugin UI, using same-origin `/api/...` requests under the active board session.
 * - Future worker loopback HTTP, reusing the same endpoints when deployment auth
 *   and base-url configuration make that path safe.
 */
export const opencodeProjectHostMutationContractSchema = z.object({
  transport: z.literal(OPENCODE_PROJECT_HOST_MUTATION_TRANSPORT),
  surface: z.literal(OPENCODE_PROJECT_HOST_MUTATION_SURFACE),
  apiBasePath: z.literal(OPENCODE_PROJECT_HOST_API_BASE_PATH),
  requiresExistingHostApi: z.literal(true),
  requiresBoardScopedMutationAuth: z.literal(true),
  supportsUiSameOriginRequests: z.literal(true),
  supportsWorkerHttpLoopback: z.literal(true),
  endpoints: z.object({
    createAgent: z.literal(OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS.createAgent),
    updateAgent: z.literal(OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS.updateAgent),
    syncAgentSkills: z.literal(OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS.syncAgentSkills),
    createCompanySkill: z.literal(OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS.createCompanySkill),
    updateCompanySkillFile: z.literal(OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS.updateCompanySkillFile),
  }),
  notes: z.array(z.string().min(1)).min(1),
});

export const opencodeProjectHostMutationContract = {
  transport: OPENCODE_PROJECT_HOST_MUTATION_TRANSPORT,
  surface: OPENCODE_PROJECT_HOST_MUTATION_SURFACE,
  apiBasePath: OPENCODE_PROJECT_HOST_API_BASE_PATH,
  requiresExistingHostApi: true,
  requiresBoardScopedMutationAuth: true,
  supportsUiSameOriginRequests: true,
  supportsWorkerHttpLoopback: true,
  endpoints: { ...OPENCODE_PROJECT_HOST_MUTATION_ENDPOINTS },
  notes: [
    "Imported agents and skills are mutated through existing Paperclip /api routes rather than new plugin SDK write clients.",
    "The MVP-safe caller is the plugin UI under same-origin board auth; worker HTTP uses the same contract only when loopback auth is explicitly supported.",
    "Cycle 2.2 should implement plan computation against this fixed REST boundary instead of inventing a new host mutation layer mid-cycle.",
    "The current REST boundary can persist agent metadata, but imported skill provenance and export bookkeeping must stay in plugin state until a host write path supports custom skill metadata/source locators.",
  ],
} as const satisfies z.infer<typeof opencodeProjectHostMutationContractSchema>;

export const opencodeProjectRemoteLinkContractSchema = z.object({
  authority: z.object({
    canonicalStateOwner: z.literal("plugin_project_workspace_state"),
    derivedRuntimeOwner: z.literal("imported_agent_adapter_config"),
    companyBaseUrlOwner: z.literal("plugin_company_settings"),
    adapterOwnsCanonicalState: z.literal(false),
  }).strict(),
  statusData: z.object({
    projectRemoteStatus: z.literal(OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY),
  }).strict(),
  actions: z.object({
    resolveRemoteModeStatus: z.literal(OPENCODE_PROJECT_RESOLVE_REMOTE_MODE_STATUS_ACTION_KEY),
    linkRemoteProjectContext: z.literal(OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY),
    refreshRemoteLink: z.literal(OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY),
    clearRemoteLink: z.literal(OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY),
  }).strict(),
  notes: z.array(z.string().min(1)).min(1),
}).strict();

export const opencodeProjectRemoteLinkContract = {
  authority: {
    canonicalStateOwner: "plugin_project_workspace_state",
    derivedRuntimeOwner: "imported_agent_adapter_config",
    companyBaseUrlOwner: "plugin_company_settings",
    adapterOwnsCanonicalState: false,
  },
  statusData: {
    projectRemoteStatus: OPENCODE_PROJECT_REMOTE_MODE_STATUS_DATA_KEY,
  },
  actions: {
    resolveRemoteModeStatus: OPENCODE_PROJECT_RESOLVE_REMOTE_MODE_STATUS_ACTION_KEY,
    linkRemoteProjectContext: OPENCODE_PROJECT_LINK_REMOTE_CONTEXT_ACTION_KEY,
    refreshRemoteLink: OPENCODE_PROJECT_REFRESH_REMOTE_LINK_ACTION_KEY,
    clearRemoteLink: OPENCODE_PROJECT_CLEAR_REMOTE_LINK_ACTION_KEY,
  },
  notes: [
    "The canonical remote link record lives in project_workspace-scoped plugin state and remains the only authority for project-level remote status.",
    "Imported opencode_full adapter config may carry a derived runtime copy, but that copy is not authoritative for link lifecycle or base URL ownership.",
    "MVP success paths assume auth.mode=none and project/path/session APIs only; no workspace provisioning/runtime is implied by this contract.",
  ],
} as const satisfies z.infer<typeof opencodeProjectRemoteLinkContractSchema>;

export type OpencodeProjectHostMutationContract = z.infer<typeof opencodeProjectHostMutationContractSchema>;
export type OpencodeProjectRemoteLinkContract = z.infer<typeof opencodeProjectRemoteLinkContractSchema>;

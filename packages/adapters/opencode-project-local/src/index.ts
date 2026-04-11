import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import {
  execute,
  getConfigSchema,
  listProjectAwareOpenCodeModels,
  sessionCodec,
  testEnvironment,
} from "./server/index.js";

export const type = "opencode_project_local";
export const label = "OpenCode (project local)";

export const DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL = "openai/gpt-5.4";

export const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL, label: DEFAULT_OPENCODE_PROJECT_LOCAL_MODEL },
  { id: "openai/gpt-5.2-codex", label: "openai/gpt-5.2-codex" },
  { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
  { id: "openai/gpt-5.1-codex-max", label: "openai/gpt-5.1-codex-max" },
  { id: "openai/gpt-5.1-codex-mini", label: "openai/gpt-5.1-codex-mini" },
];

export const agentConfigurationDoc = `# opencode_project_local agent configuration

Adapter: opencode_project_local

Use when:
- You want Paperclip to run OpenCode locally with repo-local project config enabled
- You need a canonical project workspace for import/export and runtime metadata
- You want execution to remain compatible with Paperclip worktree policies in later cycles

Don't use when:
- You want the built-in non-project-aware OpenCode runtime isolation behavior (use opencode_local)
- You need SDK/server-attach runtime transport in phase 1

Core fields:
- command (string, optional): defaults to "opencode"
- model (string, required): OpenCode model id in provider/model format
- variant (string, optional): provider-specific variant passed through to OpenCode
- cwd (string, optional): adapter fallback working directory when workspace context is unavailable
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- promptTemplate (string, optional): run prompt template
- bootstrapPromptTemplate (string, optional): bootstrap/import guidance template used by project-aware flows
- dangerouslySkipPermissions (boolean, optional): defaults to true for unattended runs
- allowProjectConfig (boolean, optional): defaults to true and preserves repo-local OpenCode config loading for this adapter type
- canonicalWorkspaceOnly (boolean, optional): restrict execution to the canonical workspace when enabled
- syncPluginKey (string, optional): plugin manifest id expected to own project sync state; defaults to "paperclip-opencode-project"

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- This adapter is intentionally separate from the built-in opencode_local adapter.
- Phase 1 foundation scaffolding ships the config and metadata contracts first; runtime execution lands in later cycles.
`;

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    sessionCodec,
    models,
    listModels: listProjectAwareOpenCodeModels,
    agentConfigurationDoc,
    detectModel: async () => null,
    getConfigSchema,
    supportsLocalAgentJwt: false,
  };
}

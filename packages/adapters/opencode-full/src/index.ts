import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import {
  execute,
  getConfigSchema,
  listModels,
  sessionCodec,
  testEnvironment,
} from "./server/index.js";

export const type = "opencode_full";
export const label = "OpenCode (full)";

const DEFAULT_OPENCODE_FULL_MODEL = "openai/gpt-5.4";

const models: Array<{ id: string; label: string }> = [
  { id: DEFAULT_OPENCODE_FULL_MODEL, label: DEFAULT_OPENCODE_FULL_MODEL },
  { id: "openai/gpt-5.2-codex", label: "openai/gpt-5.2-codex" },
  { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
  { id: "openai/gpt-5.1-codex-max", label: "openai/gpt-5.1-codex-max" },
  { id: "openai/gpt-5.1-codex-mini", label: "openai/gpt-5.1-codex-mini" },
];

export const agentConfigurationDoc = `# opencode_full agent configuration

Adapter: opencode_full

Execution modes:
- local_cli: local OpenCode CLI execution
- remote_server: already-running OpenCode server execution
- local_sdk: explicit future/deferred branch only

Design rules:
- executionMode is required and mode-specific settings stay explicit
- persisted config accepts Paperclip secret bindings for remote auth material
- runtime execution consumes only runtime-resolved remote auth values
- remote resume is gated by ownership, config fingerprint, base URL, target mode, and resolved target identity

Runtime scope note:
- local_cli remains the parity baseline
- remote_server execution is implemented only for the proven-safe server_default target
- paperclip_workspace, server_managed_namespace, and fixed_path remain deferred or unsupported
- local_sdk exists only as a deferred schema branch and is not executable
`;

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    sessionCodec,
    models,
    listModels,
    agentConfigurationDoc,
    detectModel: async () => null,
    getConfigSchema,
    supportsLocalAgentJwt: false,
  };
}

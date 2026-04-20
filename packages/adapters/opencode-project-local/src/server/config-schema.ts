import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import { z } from "zod";

export const opencodeProjectLocalConfigSchema = z.object({
  command: z.string().trim().min(1).default("opencode"),
  model: z.string().trim().min(1),
  variant: z.string().trim().min(1).optional(),
  cwd: z.string().trim().min(1).optional(),
  instructionsFilePath: z.string().trim().min(1).optional(),
  extraArgs: z.array(z.string().min(1)).default([]),
  env: z.record(z.string()).default({}),
  promptTemplate: z.string().optional(),
  bootstrapPromptTemplate: z.string().optional(),
  dangerouslySkipPermissions: z.boolean().default(true),
  allowProjectConfig: z.boolean().default(true),
  canonicalWorkspaceOnly: z.boolean().default(false),
  syncPluginKey: z.string().trim().min(1).default("paperclip-opencode-project"),
  timeoutSec: z.number().int().positive().optional(),
  graceSec: z.number().int().positive().optional(),
});

export type OpencodeProjectLocalConfig = z.infer<typeof opencodeProjectLocalConfigSchema>;

export function getOpencodeProjectLocalConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "Command",
        type: "text",
        default: "opencode",
        hint: "OpenCode CLI binary to execute.",
      },
      {
        key: "model",
        label: "Model",
        type: "combobox",
        required: true,
        hint: "OpenCode model id in provider/model format.",
      },
      {
        key: "variant",
        label: "Variant",
        type: "text",
        hint: "Optional provider-specific reasoning/profile variant.",
      },
      {
        key: "cwd",
        label: "Fallback CWD",
        type: "text",
        hint: "Adapter fallback working directory when no canonical or execution workspace is resolved.",
      },
      {
        key: "instructionsFilePath",
        label: "Instructions File Path",
        type: "text",
        hint: "Absolute path to a markdown instructions file prepended to the run prompt.",
      },
      {
        key: "extraArgs",
        label: "Extra Args",
        type: "textarea",
        hint: "Additional OpenCode CLI args. Provide one argument per line in raw config JSON when editing manually.",
      },
      {
        key: "env",
        label: "Environment Variables",
        type: "textarea",
        hint: "Additional environment variables passed to the OpenCode process.",
      },
      {
        key: "promptTemplate",
        label: "Prompt Template",
        type: "textarea",
      },
      {
        key: "bootstrapPromptTemplate",
        label: "Bootstrap Prompt Template",
        type: "textarea",
        hint: "Reserved for project bootstrap/sync UX guidance.",
      },
      {
        key: "dangerouslySkipPermissions",
        label: "Skip Permissions",
        type: "toggle",
        default: true,
        hint: "Allow unattended runs without interactive OpenCode approval prompts.",
      },
      {
        key: "allowProjectConfig",
        label: "Allow Project Config",
        type: "toggle",
        default: true,
        hint: "Enable repo-local opencode.json and .opencode discovery for this adapter type.",
      },
      {
        key: "canonicalWorkspaceOnly",
        label: "Canonical Workspace Only",
        type: "toggle",
        default: false,
        hint: "Block execution outside the canonical project workspace when enabled.",
      },
      {
        key: "syncPluginKey",
        label: "Sync Plugin Key",
        type: "text",
        default: "paperclip-opencode-project",
        hint: "Plugin manifest id expected to own project sync state.",
      },
      {
        key: "timeoutSec",
        label: "Timeout (sec)",
        type: "number",
        hint: "Optional runtime timeout in seconds.",
      },
      {
        key: "graceSec",
        label: "Grace Period (sec)",
        type: "number",
        hint: "Optional SIGTERM grace period in seconds.",
      },
    ],
  };
}

import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";
import { envBindingSchema } from "@paperclipai/shared";
import { z } from "zod";
import { validateRemoteServerBaseUrl } from "./remote-base-url.js";

export const opencodeFullExecutionModeSchema = z.enum([
  "local_cli",
  "remote_server",
  "local_sdk",
]);

export const opencodeFullSharedPersistedConfigSchema = z.object({
  executionMode: opencodeFullExecutionModeSchema,
  model: z.string().trim().min(1),
  variant: z.string().trim().min(1).optional(),
  promptTemplate: z.string().optional(),
  bootstrapPromptTemplate: z.string().optional(),
  timeoutSec: z.number().int().positive().default(120),
  connectTimeoutSec: z.number().int().positive().default(10),
  eventStreamIdleTimeoutSec: z.number().int().positive().default(30),
  failFastWhenUnavailable: z.boolean().default(true),
});

export const opencodeFullLocalCliPersistedConfigSchema = z.object({
  command: z.string().trim().min(1).default("opencode"),
  allowProjectConfig: z.boolean().default(true),
  dangerouslySkipPermissions: z.boolean().default(false),
  graceSec: z.number().int().nonnegative().default(5),
  env: z.record(envBindingSchema).default({}),
});

export const opencodeFullRemoteAuthPersistedSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("bearer"),
    token: envBindingSchema,
  }),
  z.object({
    mode: z.literal("basic"),
    username: z.string().trim().min(1),
    password: envBindingSchema,
  }),
  z.object({
    mode: z.literal("header"),
    headerName: z.string().trim().min(1),
    headerValue: envBindingSchema,
  }),
]);

export const opencodeFullRemoteProjectTargetShapeSchema = z.object({
  mode: z.enum([
    "server_default",
    "paperclip_workspace",
    "server_managed_namespace",
    "fixed_path",
  ]).default("server_default"),
  projectPath: z.string().trim().min(1).optional(),
  namespaceTemplate: z.string().trim().min(1).optional(),
  requireDedicatedServer: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.mode === "fixed_path" && !value.projectPath) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projectPath"],
      message: "projectPath is required when mode=fixed_path",
    });
  }

  if (value.mode === "server_managed_namespace" && !value.namespaceTemplate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["namespaceTemplate"],
      message: "namespaceTemplate is required when mode=server_managed_namespace",
    });
  }
});

export const opencodeFullRemoteProjectTargetSchema = opencodeFullRemoteProjectTargetShapeSchema.superRefine((value, ctx) => {
  if (value.mode !== "server_default") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mode"],
      message: "MVP currently validates only projectTarget.mode=server_default",
    });
  }
});

export const opencodeFullRemoteServerPersistedConfigSchema = z.object({
  baseUrl: z.string().trim().url().superRefine((value, ctx) => {
    const result = validateRemoteServerBaseUrl(value);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
      });
    }
  }),
  auth: opencodeFullRemoteAuthPersistedSchema.default({ mode: "none" }),
  healthTimeoutSec: z.number().int().positive().default(10),
  requireHealthyServer: z.boolean().default(true),
  projectTarget: opencodeFullRemoteProjectTargetSchema.default({ mode: "server_default" }),
});

export const opencodeFullLocalSdkPersistedConfigSchema = z.object({
  sdkProviderHint: z.string().trim().min(1).optional(),
  allowProjectConfig: z.boolean().default(true),
  env: z.record(envBindingSchema).default({}),
});

export const opencodeFullPersistedConfigSchema = opencodeFullSharedPersistedConfigSchema.and(
  z.discriminatedUnion("executionMode", [
    z.object({
      executionMode: z.literal("local_cli"),
      localCli: opencodeFullLocalCliPersistedConfigSchema.default({}),
    }),
    z.object({
      executionMode: z.literal("remote_server"),
      remoteServer: opencodeFullRemoteServerPersistedConfigSchema,
    }),
    z.object({
      executionMode: z.literal("local_sdk"),
      localSdk: opencodeFullLocalSdkPersistedConfigSchema.default({}),
    }),
  ]),
);

export type OpencodeFullPersistedConfig = z.infer<typeof opencodeFullPersistedConfigSchema>;
export type OpencodeFullExecutionMode = z.infer<typeof opencodeFullExecutionModeSchema>;
export type OpencodeFullLocalCliPersistedConfig = Extract<OpencodeFullPersistedConfig, { executionMode: "local_cli" }>;
export type OpencodeFullRemoteServerPersistedConfig = Extract<OpencodeFullPersistedConfig, { executionMode: "remote_server" }>;
export type OpencodeFullLocalSdkPersistedConfig = Extract<OpencodeFullPersistedConfig, { executionMode: "local_sdk" }>;
export type OpencodeFullRemoteAuthPersisted = z.infer<typeof opencodeFullRemoteAuthPersistedSchema>;
export type OpencodeFullRemoteProjectTarget = z.infer<typeof opencodeFullRemoteProjectTargetShapeSchema>;

export function getOpencodeFullConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "executionMode",
        label: "Execution mode",
        type: "select",
        required: true,
        default: "local_cli",
        options: [
          { value: "local_cli", label: "Local CLI" },
          { value: "remote_server", label: "Remote server" },
          { value: "local_sdk", label: "Local SDK (deferred)" },
        ],
        hint: "Explicit mode selection. local_sdk is intentionally deferred and not executable in the current MVP runtime.",
      },
      {
        key: "model",
        label: "Model",
        type: "combobox",
        required: true,
        hint: "Shared OpenCode model id in provider/model format.",
      },
      {
        key: "variant",
        label: "Variant",
        type: "text",
        hint: "Optional provider-specific reasoning/profile variant.",
      },
      {
        key: "promptTemplate",
        label: "Prompt Template",
        type: "textarea",
        group: "Shared",
      },
      {
        key: "bootstrapPromptTemplate",
        label: "Bootstrap Prompt Template",
        type: "textarea",
        group: "Shared",
      },
      {
        key: "timeoutSec",
        label: "Timeout (sec)",
        type: "number",
        default: 120,
        group: "Shared",
      },
      {
        key: "connectTimeoutSec",
        label: "Connect timeout (sec)",
        type: "number",
        default: 10,
        group: "Shared",
      },
      {
        key: "eventStreamIdleTimeoutSec",
        label: "Event stream idle timeout (sec)",
        type: "number",
        default: 30,
        group: "Shared",
      },
      {
        key: "failFastWhenUnavailable",
        label: "Fail fast when unavailable",
        type: "toggle",
        default: true,
        group: "Shared",
      },
      {
        key: "localCli.command",
        label: "Local CLI · Command",
        type: "text",
        default: "opencode",
        group: "Local CLI",
        hint: "Only used when executionMode=local_cli.",
      },
      {
        key: "localCli.allowProjectConfig",
        label: "Local CLI · Allow project config",
        type: "toggle",
        default: true,
        group: "Local CLI",
      },
      {
        key: "localCli.dangerouslySkipPermissions",
        label: "Local CLI · Skip permissions",
        type: "toggle",
        default: false,
        group: "Local CLI",
      },
      {
        key: "localCli.graceSec",
        label: "Local CLI · Grace period (sec)",
        type: "number",
        default: 5,
        group: "Local CLI",
      },
      {
        key: "localCli.env",
        label: "Local CLI · Environment bindings",
        type: "textarea",
        group: "Local CLI",
        hint: "JSON object. Secret-capable env bindings are accepted in persisted config.",
      },
      {
        key: "remoteServer.baseUrl",
        label: "Remote server · Base URL",
        type: "text",
        group: "Remote server",
        hint: "Only used when executionMode=remote_server.",
      },
      {
        key: "remoteServer.auth",
        label: "Remote server · Auth",
        type: "textarea",
        group: "Remote server",
        hint: "JSON object. Secret-capable persisted bindings accepted; runtime uses resolved values only.",
      },
      {
        key: "remoteServer.healthTimeoutSec",
        label: "Remote server · Health timeout (sec)",
        type: "number",
        default: 10,
        group: "Remote server",
      },
      {
        key: "remoteServer.requireHealthyServer",
        label: "Remote server · Require healthy server",
        type: "toggle",
        default: true,
        group: "Remote server",
      },
      {
        key: "remoteServer.projectTarget",
        label: "Remote server · Project target",
        type: "textarea",
        group: "Remote server",
        hint: "JSON object. MVP validation currently accepts only {\"mode\":\"server_default\"}.",
      },
      {
        key: "localSdk.sdkProviderHint",
        label: "Local SDK · Provider hint",
        type: "text",
        group: "Local SDK (deferred)",
        hint: "Schema-only placeholder. local_sdk is not executable yet.",
      },
      {
        key: "localSdk.allowProjectConfig",
        label: "Local SDK · Allow project config",
        type: "toggle",
        default: true,
        group: "Local SDK (deferred)",
      },
      {
        key: "localSdk.env",
        label: "Local SDK · Environment bindings",
        type: "textarea",
        group: "Local SDK (deferred)",
        hint: "JSON object placeholder for the deferred branch.",
      },
    ],
  };
}

export type {
  OpencodeFullLocalCliRuntimeConfig,
  OpencodeFullLocalSdkRuntimeConfig,
  OpencodeFullRemoteAuthRuntime,
  OpencodeFullRemoteServerRuntimeConfig,
  OpencodeFullRuntimeConfig,
} from "./runtime-schema.js";

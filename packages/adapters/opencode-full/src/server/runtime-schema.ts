import { z } from "zod";
import {
  opencodeFullRemoteProjectTargetSchema,
} from "./config-schema.js";
import { validateRemoteServerBaseUrl } from "./remote-base-url.js";

const opencodeFullSharedRuntimeConfigSchema = z.object({
  model: z.string().trim().min(1),
  variant: z.string().trim().min(1).optional(),
  promptTemplate: z.string().optional(),
  bootstrapPromptTemplate: z.string().optional(),
  timeoutSec: z.number().int().positive(),
  connectTimeoutSec: z.number().int().positive(),
  eventStreamIdleTimeoutSec: z.number().int().positive(),
  failFastWhenUnavailable: z.boolean(),
});

export const opencodeFullRemoteAuthRuntimeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({
    mode: z.literal("bearer"),
    token: z.string().trim().min(1),
  }),
  z.object({
    mode: z.literal("basic"),
    username: z.string().trim().min(1),
    password: z.string().trim().min(1),
  }),
  z.object({
    mode: z.literal("header"),
    headerName: z.string().trim().min(1),
    headerValue: z.string().trim().min(1),
  }),
]);

export const opencodeFullLocalCliRuntimeConfigSchema = opencodeFullSharedRuntimeConfigSchema.extend({
  executionMode: z.literal("local_cli"),
  localCli: z.object({
    command: z.string().trim().min(1),
    allowProjectConfig: z.boolean(),
    dangerouslySkipPermissions: z.boolean(),
    graceSec: z.number().int().nonnegative(),
    env: z.record(z.string()),
  }),
});

export const opencodeFullRemoteServerRuntimeConfigSchema = opencodeFullSharedRuntimeConfigSchema.extend({
  executionMode: z.literal("remote_server"),
  remoteServer: z.object({
    baseUrl: z.string().trim().url().superRefine((value, ctx) => {
      const result = validateRemoteServerBaseUrl(value);
      if (!result.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.message,
        });
      }
    }),
    auth: opencodeFullRemoteAuthRuntimeSchema,
    healthTimeoutSec: z.number().int().positive(),
    requireHealthyServer: z.boolean(),
    projectTarget: opencodeFullRemoteProjectTargetSchema,
  }),
});

export const opencodeFullLocalSdkRuntimeConfigSchema = opencodeFullSharedRuntimeConfigSchema.extend({
  executionMode: z.literal("local_sdk"),
  localSdk: z.object({
    sdkProviderHint: z.string().trim().min(1).optional(),
    allowProjectConfig: z.boolean(),
    env: z.record(z.string()),
  }),
});

export const opencodeFullRuntimeConfigSchema = z.discriminatedUnion("executionMode", [
  opencodeFullLocalCliRuntimeConfigSchema,
  opencodeFullRemoteServerRuntimeConfigSchema,
  opencodeFullLocalSdkRuntimeConfigSchema,
]);

export type OpencodeFullRuntimeConfig = z.infer<typeof opencodeFullRuntimeConfigSchema>;
export type OpencodeFullLocalCliRuntimeConfig = z.infer<typeof opencodeFullLocalCliRuntimeConfigSchema>;
export type OpencodeFullRemoteServerRuntimeConfig = z.infer<typeof opencodeFullRemoteServerRuntimeConfigSchema>;
export type OpencodeFullLocalSdkRuntimeConfig = z.infer<typeof opencodeFullLocalSdkRuntimeConfigSchema>;
export type OpencodeFullRemoteAuthRuntime = z.infer<typeof opencodeFullRemoteAuthRuntimeSchema>;

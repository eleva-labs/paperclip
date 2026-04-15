import type { AdapterModel } from "@paperclipai/adapter-utils";
import { opencodeFullRuntimeConfigSchema } from "./runtime-schema.js";
import {
  listLocalCliOpenCodeModels,
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
  resetLocalCliOpenCodeModelsCacheForTests,
} from "./local-models.js";
import {
  checkRemoteServerHealth,
  remoteServerExecutionScope,
  discoverRemoteServerOpenCodeModels,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
} from "./remote-models.js";

export {
  discoverLocalCliOpenCodeModels,
  ensureLocalCliOpenCodeModelConfiguredAndAvailable,
  prepareLocalCliRuntimeConfig,
  resetLocalCliOpenCodeModelsCacheForTests,
  checkRemoteServerHealth,
  discoverRemoteServerOpenCodeModels,
  ensureRemoteServerOpenCodeModelConfiguredAndAvailable,
  remoteServerExecutionScope,
};

export async function listModels(config?: unknown): Promise<AdapterModel[]> {
  if (!config) {
    const runtimeConfig = opencodeFullRuntimeConfigSchema.parse({
      executionMode: "local_cli",
      model: "openai/gpt-5.4",
      timeoutSec: 120,
      connectTimeoutSec: 10,
      eventStreamIdleTimeoutSec: 30,
      failFastWhenUnavailable: true,
      localCli: {
        command: "opencode",
        allowProjectConfig: true,
        dangerouslySkipPermissions: false,
        graceSec: 5,
        env: {},
      },
    });
    if (runtimeConfig.executionMode !== "local_cli") return [];
    return listLocalCliOpenCodeModels(runtimeConfig);
  }

  const parsed = opencodeFullRuntimeConfigSchema.parse(config);
  if (parsed.executionMode === "local_cli") return listLocalCliOpenCodeModels(parsed);
  if (parsed.executionMode === "remote_server") return discoverRemoteServerOpenCodeModels(parsed);
  return [];
}

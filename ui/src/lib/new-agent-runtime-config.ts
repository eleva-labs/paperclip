import { defaultCreateValues } from "../components/agent-config-defaults";
import { DEFAULT_OPENCODE_FULL_MODEL } from "../../../packages/adapters/opencode-full/src/ui/index";

function cloneAdapterSchemaValues(adapterSchemaValues?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!adapterSchemaValues) return undefined;
  return { ...adapterSchemaValues };
}

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  adapterSchemaValues?: Record<string, unknown>;
  adapterType?: string;
  model?: string;
}) {
  let nextAdapterSchemaValues = cloneAdapterSchemaValues(input?.adapterSchemaValues);

  if (input?.adapterType === "opencode_full") {
    const topLevelModel = typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined;
    const schemaModel =
      typeof nextAdapterSchemaValues?.model === "string" && nextAdapterSchemaValues.model.trim()
        ? nextAdapterSchemaValues.model.trim()
        : undefined;

    if (!schemaModel) {
      nextAdapterSchemaValues ??= {};
      nextAdapterSchemaValues.model = topLevelModel ?? DEFAULT_OPENCODE_FULL_MODEL;
    }
  }

  return {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      cooldownSec: 10,
      maxConcurrentRuns: 1,
    },
    ...(nextAdapterSchemaValues
      ? { draftAdapterSchemaValues: nextAdapterSchemaValues }
      : {}),
  };
}

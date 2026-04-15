import { defaultCreateValues } from "../components/agent-config-defaults";

function cloneAdapterSchemaValues(adapterSchemaValues?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!adapterSchemaValues) return undefined;
  return { ...adapterSchemaValues };
}

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  adapterSchemaValues?: Record<string, unknown>;
}) {
  return {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      cooldownSec: 10,
      maxConcurrentRuns: 1,
    },
    ...(input?.adapterSchemaValues
      ? { draftAdapterSchemaValues: cloneAdapterSchemaValues(input.adapterSchemaValues) }
      : {}),
  };
}

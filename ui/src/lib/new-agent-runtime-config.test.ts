// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildNewAgentRuntimeConfig } from "./new-agent-runtime-config";
import { DEFAULT_OPENCODE_FULL_MODEL } from "../../../packages/adapters/opencode-full/src/ui/index";

describe("buildNewAgentRuntimeConfig", () => {
  it("defaults new agents to no timer heartbeat", () => {
    expect(buildNewAgentRuntimeConfig()).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
    });
  });

  it("preserves explicit heartbeat settings", () => {
    expect(
      buildNewAgentRuntimeConfig({
        heartbeatEnabled: true,
        intervalSec: 3600,
      }),
    ).toEqual({
      heartbeat: {
        enabled: true,
        intervalSec: 3600,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
    });
  });

  it("preserves draft adapter schema values for create-mode editing", () => {
    expect(
      buildNewAgentRuntimeConfig({
        adapterSchemaValues: {
          executionMode: "remote_server",
          "remoteServer.baseUrl": "https://example.com/opencode",
        },
      }),
    ).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      draftAdapterSchemaValues: {
        executionMode: "remote_server",
        "remoteServer.baseUrl": "https://example.com/opencode",
      },
    });
  });

  it("hydrates the opencode_full draft model from the visible default when schema state omitted it", () => {
    expect(
      buildNewAgentRuntimeConfig({
        adapterType: "opencode_full",
        model: DEFAULT_OPENCODE_FULL_MODEL,
        adapterSchemaValues: {
          executionMode: "local_cli",
          "localCli.command": "opencode",
        },
      }),
    ).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      draftAdapterSchemaValues: {
        executionMode: "local_cli",
        model: DEFAULT_OPENCODE_FULL_MODEL,
        "localCli.command": "opencode",
      },
    });
  });

  it("keeps an explicit opencode_full schema model unchanged", () => {
    expect(
      buildNewAgentRuntimeConfig({
        adapterType: "opencode_full",
        model: DEFAULT_OPENCODE_FULL_MODEL,
        adapterSchemaValues: {
          executionMode: "local_cli",
          model: "anthropic/claude-sonnet-4",
        },
      }),
    ).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        cooldownSec: 10,
        maxConcurrentRuns: 1,
      },
      draftAdapterSchemaValues: {
        executionMode: "local_cli",
        model: "anthropic/claude-sonnet-4",
      },
    });
  });
});

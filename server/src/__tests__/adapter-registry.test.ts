import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { ServerAdapterModule } from "../adapters/index.js";
import {
  detectAdapterModel,
  findActiveServerAdapter,
  findServerAdapter,
  listAdapterModels,
  registerServerAdapter,
  requireServerAdapter,
  unregisterServerAdapter,
} from "../adapters/index.js";
import { setOverridePaused } from "../adapters/registry.js";

const externalAdapter: ServerAdapterModule = {
  type: "external_test",
  execute: async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
  }),
  testEnvironment: async () => ({
    adapterType: "external_test",
    status: "pass",
    checks: [],
    testedAt: new Date(0).toISOString(),
  }),
  models: [{ id: "external-model", label: "External Model" }],
  supportsLocalAgentJwt: false,
};

describe("server adapter registry", () => {
  beforeEach(() => {
    unregisterServerAdapter("external_test");
    unregisterServerAdapter("claude_local");
    setOverridePaused("claude_local", false);
  });

  afterEach(() => {
    unregisterServerAdapter("external_test");
    unregisterServerAdapter("claude_local");
    setOverridePaused("claude_local", false);
  });

  it("registers external adapters and exposes them through lookup helpers", async () => {
    expect(findServerAdapter("external_test")).toBeNull();

    registerServerAdapter(externalAdapter);

    expect(requireServerAdapter("external_test")).toBe(externalAdapter);
    expect(await listAdapterModels("external_test")).toEqual([
      { id: "external-model", label: "External Model" },
    ]);
  });

  it("removes external adapters when unregistered", () => {
    registerServerAdapter(externalAdapter);

    unregisterServerAdapter("external_test");

    expect(findServerAdapter("external_test")).toBeNull();
    expect(() => requireServerAdapter("external_test")).toThrow(
      "Unknown adapter type: external_test",
    );
  });

  it("allows external plugin to override a built-in adapter type", () => {
    // claude_local is always built-in
    const builtIn = findServerAdapter("claude_local");
    expect(builtIn).not.toBeNull();

    const plugin: ServerAdapterModule = {
      type: "claude_local",
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
      testEnvironment: async () => ({
        adapterType: "claude_local",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "plugin-model", label: "Plugin Override" }],
      supportsLocalAgentJwt: false,
    };

    registerServerAdapter(plugin);

    // Plugin wins
    const resolved = requireServerAdapter("claude_local");
    expect(resolved).toBe(plugin);
    expect(resolved.models).toEqual([
      { id: "plugin-model", label: "Plugin Override" },
    ]);
  });

  it("switches active adapter behavior back to the builtin when an override is paused", async () => {
    const builtIn = findServerAdapter("claude_local");
    expect(builtIn).not.toBeNull();

    const detectModel = vi.fn(async () => ({
      model: "plugin-model",
      provider: "plugin-provider",
      source: "plugin-source",
    }));
    const plugin: ServerAdapterModule = {
      type: "claude_local",
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
      testEnvironment: async () => ({
        adapterType: "claude_local",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "plugin-model", label: "Plugin Override" }],
      detectModel,
      supportsLocalAgentJwt: false,
    };

    registerServerAdapter(plugin);

    expect(findActiveServerAdapter("claude_local")).toBe(plugin);
    expect(await listAdapterModels("claude_local")).toEqual([
      { id: "plugin-model", label: "Plugin Override" },
    ]);
    expect(await detectAdapterModel("claude_local")).toMatchObject({
      model: "plugin-model",
      provider: "plugin-provider",
    });

    expect(setOverridePaused("claude_local", true)).toBe(true);

    expect(findActiveServerAdapter("claude_local")).not.toBe(plugin);
    expect(await listAdapterModels("claude_local")).toEqual(builtIn?.models ?? []);
    expect(await detectAdapterModel("claude_local")).toBeNull();
    expect(detectModel).toHaveBeenCalledTimes(1);
  });

  it("allows external project-aware adapters to coexist without replacing built-in opencode_local", () => {
    unregisterServerAdapter("opencode_project_local");

    const builtInOpenCode = findServerAdapter("opencode_local");
    expect(builtInOpenCode).not.toBeNull();

    const projectAdapter: ServerAdapterModule = {
      type: "opencode_project_local",
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
      testEnvironment: async () => ({
        adapterType: "opencode_project_local",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "openai/gpt-5.4", label: "GPT-5.4" }],
      supportsLocalAgentJwt: false,
    };

    registerServerAdapter(projectAdapter);

    expect(requireServerAdapter("opencode_project_local")).toBe(projectAdapter);
    expect(requireServerAdapter("opencode_local")).toBe(builtInOpenCode);

    unregisterServerAdapter("opencode_project_local");
  });

  it("allows opencode_full, opencode_project_local, and built-in opencode_local to coexist", () => {
    unregisterServerAdapter("opencode_full");
    unregisterServerAdapter("opencode_project_local");

    const builtInOpenCode = findServerAdapter("opencode_local");
    expect(builtInOpenCode).not.toBeNull();

    const fullAdapter: ServerAdapterModule = {
      type: "opencode_full",
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
      testEnvironment: async () => ({
        adapterType: "opencode_full",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "openai/gpt-5.4", label: "GPT-5.4" }],
      supportsLocalAgentJwt: false,
    };

    const projectAdapter: ServerAdapterModule = {
      type: "opencode_project_local",
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
      }),
      testEnvironment: async () => ({
        adapterType: "opencode_project_local",
        status: "pass",
        checks: [],
        testedAt: new Date(0).toISOString(),
      }),
      models: [{ id: "openai/gpt-5.4", label: "GPT-5.4" }],
      supportsLocalAgentJwt: false,
    };

    registerServerAdapter(fullAdapter);
    registerServerAdapter(projectAdapter);

    expect(requireServerAdapter("opencode_full")).toBe(fullAdapter);
    expect(requireServerAdapter("opencode_project_local")).toBe(projectAdapter);
    expect(requireServerAdapter("opencode_local")).toBe(builtInOpenCode);

    unregisterServerAdapter("opencode_full");
    unregisterServerAdapter("opencode_project_local");
  });
});

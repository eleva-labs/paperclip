import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  getRemoteProviders: vi.fn(),
  getRemoteProvider: vi.fn(),
}));

vi.mock("./remote-client.js", async () => {
  const actual = await vi.importActual<typeof import("./remote-client.js")>("./remote-client.js");
  return {
    ...actual,
    getRemoteProviders: mocked.getRemoteProviders,
    getRemoteProvider: mocked.getRemoteProvider,
  };
});

import { discoverRemoteServerOpenCodeModels, ensureRemoteServerOpenCodeModelConfiguredAndAvailable } from "./remote-models.js";

const config = {
  executionMode: "remote_server" as const,
  model: "openai/gpt-5.4",
  timeoutSec: 120,
  connectTimeoutSec: 10,
  eventStreamIdleTimeoutSec: 30,
  failFastWhenUnavailable: true,
  remoteServer: {
    baseUrl: "https://opencode.example.com",
    auth: { mode: "none" as const },
    healthTimeoutSec: 10,
    requireHealthyServer: true,
    projectTarget: { mode: "server_default" as const },
  },
};

describe("opencode_full remote models", () => {
  afterEach(() => {
    mocked.getRemoteProviders.mockReset();
    mocked.getRemoteProvider.mockReset();
  });

  it("maps configured providers/defaults into Paperclip model ids", async () => {
    mocked.getRemoteProviders.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: {
        providers: [
          { id: "openai", models: [{ id: "gpt-5.4" }, { id: "gpt-4.1" }] },
          { id: "anthropic", models: [] },
        ],
        default: { anthropic: "claude-3-7-sonnet" },
      },
    });

    await expect(discoverRemoteServerOpenCodeModels(config as never)).resolves.toEqual([
      { id: "anthropic/claude-3-7-sonnet", label: "anthropic/claude-3-7-sonnet" },
      { id: "openai/gpt-4.1", label: "openai/gpt-4.1" },
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
  });

  it("maps provider model object maps into Paperclip model ids", async () => {
    mocked.getRemoteProviders.mockResolvedValue({
      ok: true,
      status: 200,
      text: "",
      data: {
        providers: [
          {
            id: "openai",
            models: {
              "gpt-5.4": { id: "gpt-5.4", providerID: "openai", name: "GPT-5.4" },
              "gpt-5.4-mini": { id: "gpt-5.4-mini", providerID: "openai", name: "GPT-5.4 Mini" },
            },
          },
        ],
        default: { openai: "gpt-5.4-mini" },
      },
    });

    await expect(discoverRemoteServerOpenCodeModels(config as never)).resolves.toEqual([
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
      { id: "openai/gpt-5.4-mini", label: "openai/gpt-5.4-mini" },
    ]);
  });

  it("falls back to provider inventory when providers endpoint lacks model lists", async () => {
    mocked.getRemoteProviders.mockResolvedValue({ ok: true, status: 200, text: "", data: { providers: [{ id: "openai" }], default: {} } });
    mocked.getRemoteProvider.mockResolvedValue({ ok: true, status: 200, text: "", data: { all: [{ id: "openai", defaultModel: "gpt-5.4" }] } });

    await expect(discoverRemoteServerOpenCodeModels(config as never)).resolves.toEqual([
      { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
    ]);
  });

  it("rejects invalid configured model clearly", async () => {
    mocked.getRemoteProviders.mockResolvedValue({ ok: true, status: 200, text: "", data: { providers: [{ id: "openai", models: [{ id: "gpt-4.1" }] }], default: {} } });
    await expect(ensureRemoteServerOpenCodeModelConfiguredAndAvailable(config as never)).rejects.toThrow(/Configured remote OpenCode model is unavailable/);
  });
});

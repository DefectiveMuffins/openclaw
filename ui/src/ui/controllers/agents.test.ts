import { describe, expect, it, vi } from "vitest";
import {
  discoverProviderModels,
  loadAgentModelChoices,
  loadHostedProviders,
  loadToolsCatalog,
  moveHostedRoutingProvider,
  startHostedProviderAuth,
  updateHostedRoutingMode,
  updateHostedRoutingProviderEnabled,
} from "./agents.ts";
import type { AgentsState } from "./agents.ts";

function createState(): { state: AgentsState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: AgentsState = {
    client: {
      request,
    } as unknown as AgentsState["client"],
    connected: true,
    agentsLoading: false,
    agentsError: null,
    agentsList: null,
    agentsSelectedId: "main",
    agentModelChoices: [],
    agentModelDiscoveryLoading: false,
    agentModelDiscoveryError: null,
    agentModelDiscoveryImportedCount: null,
    configForm: {
      models: {
        providers: {
          lmstudio: {
            baseUrl: "http://127.0.0.1:1234/v1",
            api: "openai-responses",
            apiKey: "lmstudio",
            models: [
              {
                id: "existing-model",
                name: "Existing Model",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 4096,
                maxTokens: 1024,
              },
            ],
          },
        },
      },
    },
    configSnapshot: null,
    configFormMode: "form",
    configRaw: "{}",
    configFormDirty: false,
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    hostedProvidersLoading: false,
    hostedProvidersError: null,
    hostedProvidersResult: null,
    hostedProvidersNotice: null,
    hostedProviderAuthBusy: false,
    hostedProviderAuthError: null,
    hostedProviderAuthProviderId: null,
    hostedProviderAuthSessionId: null,
    hostedProviderAuthStep: null,
    hostedProviderAuthValue: null,
  };
  return { state, request };
}

describe("loadAgentModelChoices", () => {
  it("loads the full live catalog for the agent model picker", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      models: [
        { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", provider: "lmstudio" },
        { id: "gpt-4.1", name: "GPT-4.1", provider: "openai" },
      ],
    });

    await loadAgentModelChoices(state);

    expect(request).toHaveBeenCalledWith("models.list", { includeAll: true });
    expect(state.agentModelChoices).toEqual([
      { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", provider: "lmstudio" },
      { id: "gpt-4.1", name: "GPT-4.1", provider: "openai" },
    ]);
  });

  it("falls back to an empty list when the catalog request fails", async () => {
    const { state, request } = createState();
    state.agentModelChoices = [{ id: "stale", name: "stale", provider: "openai" }];
    request.mockRejectedValue(new Error("gateway unavailable"));

    await loadAgentModelChoices(state);

    expect(state.agentModelChoices).toEqual([]);
  });
});

describe("discoverProviderModels", () => {
  it("imports discovered LM Studio models into the config draft and picker", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      providerId: "lmstudio",
      models: [
        {
          id: "qwen2.5-coder",
          name: "Qwen 2.5 Coder",
          provider: "lmstudio",
          contextWindow: 131072,
          input: ["text", "image"],
        },
      ],
    });

    await discoverProviderModels(state, "lmstudio");

    expect(request).toHaveBeenCalledWith("models.discoverProvider", { providerId: "lmstudio" });
    expect(state.agentModelChoices).toEqual([
      {
        id: "qwen2.5-coder",
        name: "Qwen 2.5 Coder",
        provider: "lmstudio",
        contextWindow: 131072,
        input: ["text", "image"],
      },
    ]);
    expect(state.agentModelDiscoveryImportedCount).toBe(1);
    expect(state.configFormDirty).toBe(true);
    expect(state.configForm).toMatchObject({
      models: {
        providers: {
          lmstudio: {
            baseUrl: "http://127.0.0.1:1234/v1",
            api: "openai-responses",
            apiKey: "lmstudio",
            models: [
              {
                id: "existing-model",
                name: "Existing Model",
                contextWindow: 4096,
                maxTokens: 1024,
              },
              {
                id: "qwen2.5-coder",
                name: "Qwen 2.5 Coder",
                contextWindow: 131072,
                maxTokens: 8192,
                input: ["text", "image"],
              },
            ],
          },
        },
      },
    });
  });

  it("captures discovery errors for the UI", async () => {
    const { state, request } = createState();
    request.mockRejectedValue(new Error("LM Studio offline"));

    await discoverProviderModels(state, "lmstudio");

    expect(state.agentModelDiscoveryError).toContain("LM Studio offline");
    expect(state.agentModelDiscoveryImportedCount).toBeNull();
    expect(state.agentModelDiscoveryLoading).toBe(false);
  });
});

describe("updateHostedRoutingMode", () => {
  it("opts into hosted rotation while preserving configured order", () => {
    const { state } = createState();
    state.configForm = {
      agents: {
        defaults: {
          hostedRouting: {
            enabled: false,
            providerOrder: ["google", "qwen-portal"],
            appendConfiguredModels: false,
          },
        },
      },
    };

    updateHostedRoutingMode(state, "prefer-hosted");

    expect(state.configForm).toMatchObject({
      agents: {
        defaults: {
          hostedRouting: {
            enabled: true,
            mode: "prefer-hosted",
            providerOrder: ["google", "qwen-portal"],
            appendConfiguredModels: false,
          },
        },
      },
    });
    expect(state.configFormDirty).toBe(true);
  });

  it("turns hosted rotation off without dropping the existing mode metadata", () => {
    const { state } = createState();
    state.configForm = {
      agents: {
        defaults: {
          hostedRouting: {
            enabled: true,
            mode: "hosted-only",
            providerOrder: ["moonshot"],
          },
        },
      },
    };

    updateHostedRoutingMode(state, "off");

    expect(state.configForm).toMatchObject({
      agents: {
        defaults: {
          hostedRouting: {
            enabled: false,
            mode: "hosted-only",
            providerOrder: ["moonshot"],
          },
        },
      },
    });
  });
});
describe("loadToolsCatalog", () => {
  it("loads catalog and stores result", async () => {
    const { state, request } = createState();
    const payload = {
      agentId: "main",
      profiles: [{ id: "full", label: "Full" }],
      groups: [
        {
          id: "media",
          label: "Media",
          source: "core",
          tools: [{ id: "tts", label: "tts", description: "Text-to-speech", source: "core" }],
        },
      ],
    };
    request.mockResolvedValue(payload);

    await loadToolsCatalog(state, "main");

    expect(request).toHaveBeenCalledWith("tools.catalog", {
      agentId: "main",
      includePlugins: true,
    });
    expect(state.toolsCatalogResult).toEqual(payload);
    expect(state.toolsCatalogError).toBeNull();
    expect(state.toolsCatalogLoading).toBe(false);
  });

  it("captures request errors for fallback UI handling", async () => {
    const { state, request } = createState();
    request.mockRejectedValue(new Error("gateway unavailable"));

    await loadToolsCatalog(state, "main");

    expect(state.toolsCatalogResult).toBeNull();
    expect(state.toolsCatalogError).toContain("gateway unavailable");
    expect(state.toolsCatalogLoading).toBe(false);
  });
});

describe("loadHostedProviders", () => {
  it("loads hosted provider status for the control UI", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      enabled: false,
      mode: "prefer-hosted",
      configuredOrder: [],
      effectiveOrder: ["google", "qwen-portal"],
      appendConfiguredModels: true,
      providers: [
        {
          provider: "google",
          label: "Google Gemini",
          modelRef: "google/gemini-3-pro-preview",
          authMode: "api-key",
          riskLabel: "official",
          docsUrl: "https://docs.openclaw.ai/providers/google",
          optInOnly: false,
          available: false,
          skipReasons: ["no auth"],
        },
      ],
    });

    await loadHostedProviders(state);

    expect(request).toHaveBeenCalledWith("models.hostedProviders", {});
    expect(state.hostedProvidersResult?.providers[0]?.provider).toBe("google");
    expect(state.hostedProvidersError).toBeNull();
  });
});

describe("hosted routing provider order", () => {
  it("adds and removes providers from the draft order", () => {
    const { state } = createState();
    state.hostedProvidersResult = {
      enabled: false,
      mode: "prefer-hosted",
      configuredOrder: [],
      effectiveOrder: ["google", "qwen-portal"],
      appendConfiguredModels: true,
      providers: [],
    };

    updateHostedRoutingProviderEnabled(state, "moonshot", true);
    updateHostedRoutingProviderEnabled(state, "google", false);

    expect(state.configForm).toMatchObject({
      agents: {
        defaults: {
          hostedRouting: {
            providerOrder: ["qwen-portal", "moonshot"],
          },
        },
      },
    });
  });

  it("reorders selected hosted providers in the draft", () => {
    const { state } = createState();
    state.configForm = {
      agents: {
        defaults: {
          hostedRouting: {
            providerOrder: ["google", "qwen-portal", "moonshot"],
          },
        },
      },
    };

    moveHostedRoutingProvider(state, "moonshot", "up");

    expect(state.configForm).toMatchObject({
      agents: {
        defaults: {
          hostedRouting: {
            providerOrder: ["google", "moonshot", "qwen-portal"],
          },
        },
      },
    });
  });
});

describe("startHostedProviderAuth", () => {
  it("starts a provider auth wizard from the UI", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      sessionId: "wiz-1",
      done: false,
      status: "running",
      step: {
        id: "step-1",
        type: "text",
        title: "Enter key",
        message: "Enter API key",
        sensitive: true,
      },
    });

    const status = await startHostedProviderAuth(state, "google");

    expect(status).toBe("running");
    expect(request).toHaveBeenCalledWith("wizard.start", {
      kind: "hosted-provider-auth",
      providerId: "google",
    });
    expect(state.hostedProviderAuthSessionId).toBe("wiz-1");
    expect(state.hostedProviderAuthStep?.type).toBe("text");
    expect(state.hostedProviderAuthProviderId).toBe("google");
  });
});


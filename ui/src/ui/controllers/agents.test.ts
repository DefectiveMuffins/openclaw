import { describe, expect, it, vi } from "vitest";
import { loadAgentModelChoices, loadToolsCatalog } from "./agents.ts";
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
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
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


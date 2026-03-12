import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";

const hoisted = vi.hoisted(() => ({
  loadModelCatalogMock: vi.fn(),
}));

vi.mock("../model-catalog.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../model-catalog.js")>();
  return {
    ...mod,
    loadModelCatalog: (...args: unknown[]) => hoisted.loadModelCatalogMock(...args),
  };
});

const { createModelsListTool } = await import("./models-list-tool.js");

const discoveredCatalog = [
  {
    id: "gpt-small",
    name: "GPT Small",
    provider: "openai",
    reasoning: false,
    input: ["text"],
    contextWindow: 16_000,
    cost: {
      input: 0.1,
      output: 0.2,
      cacheRead: 0,
      cacheWrite: 0,
    },
  },
  {
    id: "gpt-main",
    name: "GPT Main",
    provider: "openai",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128_000,
    cost: {
      input: 0.4,
      output: 0.5,
      cacheRead: 0,
      cacheWrite: 0,
    },
  },
  {
    id: "claude-large",
    name: "Claude Large",
    provider: "anthropic",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    cost: {
      input: 0.8,
      output: 1.2,
      cacheRead: 0,
      cacheWrite: 0,
    },
  },
] as const;

function makeConfig(): OpenClawConfig {
  return {
    session: {
      mainKey: "main",
      scope: "per-sender",
    },
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-main",
        },
        models: {
          "openai/gpt-small": {
            alias: "small",
          },
          "openai/gpt-main": {
            alias: "main",
          },
          "anthropic/claude-large": {
            alias: "large",
          },
          "openai/gpt-synthetic": {
            alias: "synthetic",
          },
        },
        subagents: {
          model: "small",
          allowAgents: ["research"],
        },
      },
      list: [
        {
          id: "main",
          subagents: {
            allowAgents: ["research"],
          },
        },
        {
          id: "research",
          model: {
            primary: "anthropic/claude-large",
          },
          subagents: {
            model: "small",
          },
        },
      ],
    },
  } as unknown as OpenClawConfig;
}

describe("models_list tool", () => {
  beforeEach(() => {
    hoisted.loadModelCatalogMock.mockReset().mockResolvedValue(discoveredCatalog);
  });

  it("returns only allowed discovered models sorted cheapest-known-first", async () => {
    const tool = createModelsListTool({
      agentSessionKey: "agent:main:main",
      config: makeConfig(),
    });

    const result = await tool.execute("call-models-1", {});
    const details = result.details as {
      requesterAgentId: string;
      targetAgentId: string;
      defaults: {
        effectiveDefaultModel: string;
        configuredSubagentDefault?: string;
        resolvedConfiguredSubagentDefault?: string;
      };
      allowAny: boolean;
      models: Array<{
        ref: string;
        aliases: string[];
        name: string;
        reasoning: boolean;
        input: string[];
        contextWindow?: number;
        discovered: boolean;
        cost?: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
        };
      }>;
    };

    expect(details.requesterAgentId).toBe("main");
    expect(details.targetAgentId).toBe("main");
    expect(details.defaults).toEqual({
      effectiveDefaultModel: "openai/gpt-main",
      configuredSubagentDefault: "small",
      resolvedConfiguredSubagentDefault: "openai/gpt-small",
    });
    expect(details.allowAny).toBe(false);
    expect(details.models.map((entry) => entry.ref)).toEqual([
      "openai/gpt-small",
      "openai/gpt-main",
      "anthropic/claude-large",
    ]);
    expect(details.models.every((entry) => entry.discovered)).toBe(true);
    expect(details.models.some((entry) => entry.ref === "openai/gpt-synthetic")).toBe(false);

    const cheapest = details.models[0];
    expect(cheapest).toMatchObject({
      ref: "openai/gpt-small",
      aliases: ["small"],
      name: "GPT Small",
      reasoning: false,
      input: ["text"],
      contextWindow: 16_000,
      cost: {
        input: 0.1,
        output: 0.2,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("resolves target agent defaults and subagent defaults", async () => {
    const tool = createModelsListTool({
      agentSessionKey: "agent:main:main",
      config: makeConfig(),
    });

    const result = await tool.execute("call-models-2", {
      agentId: "research",
    });

    const details = result.details as {
      requesterAgentId: string;
      targetAgentId: string;
      defaults: {
        effectiveDefaultModel: string;
        configuredSubagentDefault?: string;
        resolvedConfiguredSubagentDefault?: string;
      };
    };

    expect(details.requesterAgentId).toBe("main");
    expect(details.targetAgentId).toBe("research");
    expect(details.defaults).toEqual({
      effectiveDefaultModel: "anthropic/claude-large",
      configuredSubagentDefault: "small",
      resolvedConfiguredSubagentDefault: "openai/gpt-small",
    });
  });

  it("rejects unauthorized target agents", async () => {
    const tool = createModelsListTool({
      agentSessionKey: "agent:main:main",
      config: makeConfig(),
    });

    await expect(
      tool.execute("call-models-3", {
        agentId: "ops",
      }),
    ).rejects.toThrow(/models_list target resolution/i);
  });
});

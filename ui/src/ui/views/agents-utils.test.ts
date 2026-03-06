import { describe, expect, it } from "vitest";
import type { AgentsProps } from "./agents.ts";

async function loadAgentsUtils() {
  return import("./agents-utils.ts");
}

function collectTemplateMarkup(value: unknown): string {
  if (
    value == null ||
    typeof value === "boolean" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => collectTemplateMarkup(entry)).join("");
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value !== "object") {
    return "";
  }
  const template = value as {
    strings?: unknown;
    values?: unknown;
  };
  if (!Array.isArray(template.strings) || !Array.isArray(template.values)) {
    return "";
  }
  const strings = template.strings as string[];
  const values = template.values;
  let markup = "";
  for (let index = 0; index < strings.length; index += 1) {
    markup += strings[index] ?? "";
    if (index < values.length) {
      markup += collectTemplateMarkup(values[index]);
    }
  }
  return markup;
}

function renderTemplateText(value: unknown): string {
  return collectTemplateMarkup(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("resolveEffectiveModelFallbacks", () => {
  it("inherits defaults when no entry fallbacks are configured", async () => {
    const { resolveEffectiveModelFallbacks } = await loadAgentsUtils();
    const entryModel = undefined;
    const defaultModel = {
      primary: "openai/gpt-5-nano",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([
      "google/gemini-2.0-flash",
    ]);
  });

  it("prefers entry fallbacks over defaults", async () => {
    const { resolveEffectiveModelFallbacks } = await loadAgentsUtils();
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: ["openai/gpt-5-nano"],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual(["openai/gpt-5-nano"]);
  });

  it("keeps explicit empty entry fallback lists", async () => {
    const { resolveEffectiveModelFallbacks } = await loadAgentsUtils();
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: [],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([]);
  });
});

describe("resolveConfiguredCronModelSuggestions", () => {
  it("collects defaults primary/fallbacks, alias map keys, and per-agent model entries", async () => {
    const { resolveConfiguredCronModelSuggestions } = await loadAgentsUtils();
    const result = resolveConfiguredCronModelSuggestions({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
            fallbacks: ["google/gemini-2.5-pro", "openai/gpt-5.2-mini"],
          },
          models: {
            "anthropic/claude-sonnet-4-5": { alias: "smart" },
            "openai/gpt-5.2": { alias: "main" },
          },
        },
        list: {
          writer: {
            model: { primary: "xai/grok-4", fallbacks: ["openai/gpt-5.2-mini"] },
          },
          planner: {
            model: "google/gemini-2.5-flash",
          },
        },
      },
    });

    expect(result).toEqual([
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "openai/gpt-5.2",
      "openai/gpt-5.2-mini",
      "xai/grok-4",
    ]);
  });

  it("returns empty array for invalid or missing config shape", async () => {
    const { resolveConfiguredCronModelSuggestions } = await loadAgentsUtils();
    expect(resolveConfiguredCronModelSuggestions(null)).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({})).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({ agents: { defaults: { model: "" } } })).toEqual(
      [],
    );
  });
});

describe("resolveAgentOptimizationSummary", () => {
  it("merges agent overrides with staged retrieval and delegation defaults", async () => {
    const { resolveAgentOptimizationSummary } = await loadAgentsUtils();
    const result = resolveAgentOptimizationSummary(
      {
        agents: {
          defaults: {
            thinkingDefault: "adaptive",
            skills: { promptMode: "compact" },
            memorySearch: {
              enabled: true,
              provider: "openai",
              query: { routing: { enabled: true, maxQueries: 3, deepQueryThreshold: 0.6 } },
              workingSet: {
                enabled: true,
                sources: ["toolResults"],
                ttlMs: 30000,
                maxEntries: 200,
              },
            },
            modelRouting: {
              enabled: true,
              plannerModel: "anthropic/claude-haiku-4-5",
              retrievalModel: "anthropic/claude-haiku-4-5",
              escalation: { minConfidence: 0.7, maxCheapPasses: 2 },
            },
            subagents: {
              autoTier: true,
              simpleTaskModel: "anthropic/claude-haiku-4-5",
              delegation: {
                enabled: true,
                structuredResults: true,
                parallelResearch: { enabled: true, maxConcurrent: 4 },
              },
            },
          },
          list: [
            {
              id: "writer",
              memorySearch: {
                query: { routing: { maxQueries: 2 } },
                workingSet: { sources: ["subagentReports"] },
              },
              subagents: {
                delegation: { parallelResearch: { maxConcurrent: 2 } },
              },
            },
          ],
        },
      },
      "writer",
    );

    expect(result.thinkingDefault).toBe("adaptive");
    expect(result.skillsPromptMode).toBe("compact");
    expect(result.memorySearch.enabled).toBe(true);
    expect(result.memorySearch.provider).toBe("openai");
    expect(result.memorySearch.maxQueries).toBe(2);
    expect(result.memorySearch.workingSetSources).toEqual(["toolResults", "subagentReports"]);
    expect(result.modelRouting.enabled).toBe(true);
    expect(result.modelRouting.plannerModel).toBe("anthropic/claude-haiku-4-5");
    expect(result.modelRouting.minConfidence).toBe(0.7);
    expect(result.subagents.autoTier).toBe(true);
    expect(result.subagents.parallelResearchEnabled).toBe(true);
    expect(result.subagents.parallelResearchMaxConcurrent).toBe(2);
    expect(result.subagents.structuredResults).toBe(true);
  });
});

function createAgentsProps(overrides: Partial<AgentsProps> = {}): AgentsProps {
  return {
    loading: false,
    error: null,
    agentsList: {
      defaultId: "writer",
      mainKey: "agent:writer:main",
      scope: "per-sender",
      agents: [
        {
          id: "writer",
          name: "Writer",
          identity: { name: "Writer", emoji: "W" },
        },
      ],
    },
    selectedAgentId: "writer",
    activePanel: "overview",
    modelChoices: [
      { id: "qwen2.5-coder", name: "Qwen 2.5 Coder", provider: "lmstudio" },
    ],
    configForm: {
      agents: {
        defaults: {
          workspace: "/workspace/default",
          thinkingDefault: "adaptive",
          skills: { promptMode: "compact" },
          memorySearch: {
            enabled: true,
            provider: "openai",
            query: { routing: { enabled: true, maxQueries: 3, deepQueryThreshold: 0.65 } },
            workingSet: {
              enabled: true,
              sources: ["toolResults"],
              ttlMs: 30000,
              maxEntries: 200,
            },
          },
          modelRouting: {
            enabled: true,
            plannerModel: "anthropic/claude-haiku-4-5",
            retrievalModel: "anthropic/claude-haiku-4-5",
            compressionModel: "anthropic/claude-haiku-4-5",
            verificationModel: "openai/gpt-5.2-mini",
            escalation: { minConfidence: 0.7, maxCheapPasses: 2 },
          },
          subagents: {
            autoTier: true,
            simpleTaskModel: "anthropic/claude-haiku-4-5",
            delegation: {
              enabled: true,
              structuredResults: true,
              parallelResearch: { enabled: true, maxConcurrent: 3 },
            },
          },
          model: { primary: "openai/gpt-5.2" },
        },
        list: [
          {
            id: "writer",
            workspace: "/workspace/writer",
            model: { primary: "openai/gpt-5.2-mini" },
            memorySearch: {
              workingSet: { sources: ["subagentReports"] },
            },
          },
        ],
      },
    },
    configLoading: false,
    configSaving: false,
    configDirty: false,
    channelsLoading: false,
    channelsError: null,
    channelsSnapshot: null,
    channelsLastSuccess: null,
    cronLoading: false,
    cronStatus: null,
    cronJobs: [],
    cronError: null,
    agentFilesLoading: false,
    agentFilesError: null,
    agentFilesList: {
      agentId: "writer",
      workspace: "/workspace/writer",
      files: [],
    },
    agentFileActive: null,
    agentFileContents: {},
    agentFileDrafts: {},
    agentFileSaving: false,
    agentIdentityLoading: false,
    agentIdentityError: null,
    agentIdentityById: {
      writer: {
        agentId: "writer",
        name: "Writer",
        avatar: "W",
        emoji: "W",
      },
    },
    agentSkillsLoading: false,
    agentSkillsReport: null,
    agentSkillsError: null,
    agentSkillsAgentId: "writer",
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    skillsFilter: "",
    onRefresh: () => undefined,
    onSelectAgent: () => undefined,
    onSelectPanel: () => undefined,
    onLoadFiles: () => undefined,
    onSelectFile: () => undefined,
    onFileDraftChange: () => undefined,
    onFileReset: () => undefined,
    onFileSave: () => undefined,
    onToolsProfileChange: () => undefined,
    onToolsOverridesChange: () => undefined,
    onConfigReload: () => undefined,
    onConfigSave: () => undefined,
    onModelChange: () => undefined,
    onModelFallbacksChange: () => undefined,
    onChannelsRefresh: () => undefined,
    onCronRefresh: () => undefined,
    onSkillsFilterChange: () => undefined,
    onSkillsRefresh: () => undefined,
    onAgentSkillToggle: () => undefined,
    onAgentSkillsClear: () => undefined,
    onAgentSkillsDisableAll: () => undefined,
    ...overrides,
  };
}

describe("buildModelOptions", () => {
  it("includes live catalog models alongside configured aliases", async () => {
    const { buildModelOptions } = await loadAgentsUtils();
    const template = buildModelOptions(
      {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5.2": { alias: "Primary" },
            },
          },
        },
      },
      null,
      [{ id: "qwen2.5-coder", name: "Qwen 2.5 Coder", provider: "lmstudio" }],
    );
    const text = renderTemplateText(template);

    expect(text).toContain("Primary (openai/gpt-5.2)");
    expect(text).toContain("Qwen 2.5 Coder (lmstudio/qwen2.5-coder)");
  });
});
describe("renderAgents overview", () => {
  it("renders the staged RAG and delegation summary cards", async () => {
    const { renderAgents } = await import("./agents.ts");
    const text = renderTemplateText(renderAgents(createAgentsProps()));

    expect(text).toContain("RAG and Delegation");
    expect(text).toContain("Memory Search");
    expect(text).toContain("Working Set");
    expect(text).toContain("Cheap-Stage Routing");
    expect(text).toContain("Escalation");
    expect(text).toContain("Thinking and Skills");
    expect(text).toContain("Subagent Defaults");
    expect(text).toContain("adaptive");
    expect(text).toContain("skills compact");
    expect(text).toContain("research fan-out 3");
  });
});


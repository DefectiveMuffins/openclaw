import { describe, expect, it } from "vitest";
import type { TimeSeriesPoint, UsageSessionEntry } from "./usageTypes.ts";

async function loadUsageRenderDetails() {
  return import("./usage-render-details.ts");
}

async function loadUsageRenderOverview() {
  return import("./usage-render-overview.ts");
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
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
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

function makePoint(overrides: Partial<TimeSeriesPoint> = {}): TimeSeriesPoint {
  return {
    timestamp: 1000,
    totalTokens: 100,
    cost: 0.01,
    input: 30,
    output: 40,
    cacheRead: 20,
    cacheWrite: 10,
    cumulativeTokens: 0,
    cumulativeCost: 0,
    ...overrides,
  };
}

const baseUsage = {
  totalTokens: 1000,
  totalCost: 1.0,
  input: 300,
  output: 400,
  cacheRead: 200,
  cacheWrite: 100,
  inputCost: 0.3,
  outputCost: 0.4,
  cacheReadCost: 0.2,
  cacheWriteCost: 0.1,
  durationMs: 60000,
  firstActivity: 0,
  lastActivity: 60000,
  missingCostEntries: 0,
  messageCounts: {
    total: 10,
    user: 5,
    assistant: 5,
    toolCalls: 0,
    toolResults: 0,
    errors: 0,
  },
} satisfies NonNullable<UsageSessionEntry["usage"]>;

describe("computeFilteredUsage", () => {
  it("returns undefined when no points match the range", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [makePoint({ timestamp: 1000 }), makePoint({ timestamp: 2000 })];
    const result = computeFilteredUsage(baseUsage, points, 3000, 4000);
    expect(result).toBeUndefined();
  });

  it("aggregates tokens and cost for points within range", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [
      makePoint({ timestamp: 1000, totalTokens: 100, cost: 0.1 }),
      makePoint({ timestamp: 2000, totalTokens: 200, cost: 0.2 }),
      makePoint({ timestamp: 3000, totalTokens: 300, cost: 0.3 }),
    ];
    const result = computeFilteredUsage(baseUsage, points, 1000, 2000);
    expect(result).toBeDefined();
    expect(result!.totalTokens).toBe(300);
    expect(result!.totalCost).toBeCloseTo(0.3);
  });

  it("handles reversed range (end < start)", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [
      makePoint({ timestamp: 1000, totalTokens: 50 }),
      makePoint({ timestamp: 2000, totalTokens: 75 }),
    ];
    const result = computeFilteredUsage(baseUsage, points, 2000, 1000);
    expect(result).toBeDefined();
    expect(result!.totalTokens).toBe(125);
  });

  it("counts message types based on input/output presence", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [
      makePoint({ timestamp: 1000, input: 10, output: 0 }),
      makePoint({ timestamp: 2000, input: 0, output: 20 }),
      makePoint({ timestamp: 3000, input: 5, output: 15 }),
    ];
    const result = computeFilteredUsage(baseUsage, points, 1000, 3000);
    expect(result!.messageCounts!.user).toBe(2);
    expect(result!.messageCounts!.assistant).toBe(2);
    expect(result!.messageCounts!.total).toBe(3);
  });

  it("computes duration from first to last filtered point", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [makePoint({ timestamp: 1000 }), makePoint({ timestamp: 5000 })];
    const result = computeFilteredUsage(baseUsage, points, 1000, 5000);
    expect(result!.durationMs).toBe(4000);
    expect(result!.firstActivity).toBe(1000);
    expect(result!.lastActivity).toBe(5000);
  });

  it("aggregates token types (input, output, cacheRead, cacheWrite)", async () => {
    const { computeFilteredUsage } = await loadUsageRenderDetails();
    const points = [
      makePoint({ timestamp: 1000, input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }),
      makePoint({ timestamp: 2000, input: 5, output: 15, cacheRead: 25, cacheWrite: 35 }),
    ];
    const result = computeFilteredUsage(baseUsage, points, 1000, 2000);
    expect(result!.input).toBe(15);
    expect(result!.output).toBe(35);
    expect(result!.cacheRead).toBe(55);
    expect(result!.cacheWrite).toBe(75);
  });
});

describe("chart bar sizing", () => {
  it("bar width ratio and max are reasonable", async () => {
    const { CHART_BAR_WIDTH_RATIO, CHART_MAX_BAR_WIDTH } = await loadUsageRenderDetails();
    expect(CHART_BAR_WIDTH_RATIO).toBeGreaterThan(0);
    expect(CHART_BAR_WIDTH_RATIO).toBeLessThan(1);
    expect(CHART_MAX_BAR_WIDTH).toBeGreaterThan(0);
  });

  it("bars fit within chart width for typical point counts", async () => {
    const { CHART_BAR_WIDTH_RATIO, CHART_MAX_BAR_WIDTH } = await loadUsageRenderDetails();
    const chartWidth = 366;
    for (const n of [1, 2, 10, 50, 100, 200]) {
      const slotWidth = chartWidth / n;
      const barWidth = Math.min(
        CHART_MAX_BAR_WIDTH,
        Math.max(1, slotWidth * CHART_BAR_WIDTH_RATIO),
      );
      const barGap = slotWidth - barWidth;
      expect(n * slotWidth).toBeCloseTo(chartWidth);
      if (slotWidth >= 1 / CHART_BAR_WIDTH_RATIO) {
        expect(barGap).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("usage overview cards", () => {
  it("renders aggregate efficiency cards for staged routing and delegation", async () => {
    const { buildUsageAgenticOverviewStats, renderUsageInsights } = await loadUsageRenderOverview();
    const agenticStats = buildUsageAgenticOverviewStats([
      {
        key: "s1",
        agentId: "writer",
        channel: "discord",
        routing: { phase: "retrieval", cheapPath: true, escalated: false },
        agenticCounters: {
          routedRuns: 4,
          cheapPathRuns: 3,
          escalations: 1,
          delegationReports: 2,
          structuredDelegationReports: 2,
          delegationConflictSignals: 1,
        },
        usage: {
          ...baseUsage,
          agentic: {
            memorySearch: {
              calls: 4,
              hitCalls: 2,
              workingSetHits: 3,
            },
            delegation: {
              spawnCalls: 2,
              accepted: 2,
              structuredResponses: 2,
              readOnlySpawns: 2,
              roles: [],
              modelsApplied: [],
            },
          },
          toolUsage: {
            totalCalls: 2,
            uniqueTools: 2,
            tools: [{ name: "memory_search", count: 1 }],
          },
          activityDates: ["2026-03-05"],
        },
      },
    ]);

    const text = renderTemplateText(
      renderUsageInsights(
        {
          input: 300,
          output: 400,
          cacheRead: 200,
          cacheWrite: 100,
          totalTokens: 1000,
          totalCost: 1,
          inputCost: 0.3,
          outputCost: 0.4,
          cacheReadCost: 0.2,
          cacheWriteCost: 0.1,
          missingCostEntries: 0,
        },
        {
          messages: { total: 10, user: 5, assistant: 5, toolCalls: 2, toolResults: 2, errors: 1 },
          tools: { totalCalls: 2, uniqueTools: 2, tools: [{ name: "memory_search", count: 1 }] },
          byModel: [],
          byProvider: [],
          byAgent: [
            {
              agentId: "writer",
              totals: {
                input: 300,
                output: 400,
                cacheRead: 200,
                cacheWrite: 100,
                totalTokens: 1000,
                totalCost: 1,
                inputCost: 0.3,
                outputCost: 0.4,
                cacheReadCost: 0.2,
                cacheWriteCost: 0.1,
                missingCostEntries: 0,
              },
            },
          ],
          byChannel: [
            {
              channel: "discord",
              totals: {
                input: 300,
                output: 400,
                cacheRead: 200,
                cacheWrite: 100,
                totalTokens: 1000,
                totalCost: 1,
                inputCost: 0.3,
                outputCost: 0.4,
                cacheReadCost: 0.2,
                cacheWriteCost: 0.1,
                missingCostEntries: 0,
              },
            },
          ],
          daily: [
            { date: "2026-03-05", tokens: 1000, cost: 1, messages: 10, toolCalls: 2, errors: 1 },
          ],
        },
        {
          durationSumMs: 60000,
          durationCount: 1,
          avgDurationMs: 60000,
          throughputTokensPerMin: 1000,
          throughputCostPerMin: 1,
          errorRate: 0.1,
        },
        agenticStats,
        false,
        [],
        1,
        1,
      ),
    );

    expect(text).toContain("Cheap Path Rate");
    expect(text).toContain("75.0%");
    expect(text).toContain("Working-Set Hit Rate");
    expect(text).toContain("50.0%");
    expect(text).toContain("Escalations");
    expect(text).toContain("25.0%");
    expect(text).toContain("Conflict Signals");
    expect(text).toContain("2 reports");
    expect(text).toContain("Agentic by Agent");
    expect(text).toContain("writer");
    expect(text).toContain("Agentic by Channel");
    expect(text).toContain("discord");
  });
});

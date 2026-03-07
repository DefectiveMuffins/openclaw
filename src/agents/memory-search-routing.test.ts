import { describe, expect, it } from "vitest";
import type { MemorySearchResult } from "../memory/types.js";
import {
  classifyMemorySearchIntent,
  estimateMemorySearchConfidence,
  packMemorySearchResults,
  resolveMemorySearchPlan,
} from "./memory-search-routing.js";

describe("memory-search-routing", () => {
  it("classifies code-context queries and prefers working-set when available", () => {
    const intent = classifyMemorySearchIntent(
      "Check src/agents/tool-working-set.ts around line 20",
    );
    expect(intent).toBe("code-context");

    const plan = resolveMemorySearchPlan({
      query: "Check src/agents/tool-working-set.ts around line 20",
      maxResults: 4,
      minScore: 0.35,
      routing: {
        enabled: true,
        maxQueries: 3,
        deepQueryThreshold: 80,
      },
      hasWorkingSet: true,
    });

    expect(plan.sourceBias).toBe("working-set");
    expect(plan.workingSetFirst).toBe(true);
    expect(plan.queries).toEqual(["Check src/agents/tool-working-set.ts around line 20"]);
  });

  it("uses deep multi-query recall for decision-style questions", () => {
    const plan = resolveMemorySearchPlan({
      query:
        "Why did we decide to keep compaction relevance pruning instead of recency-only pruning?",
      maxResults: 5,
      minScore: 0.4,
      routing: {
        enabled: true,
        maxQueries: 3,
        deepQueryThreshold: 60,
      },
      hasWorkingSet: false,
    });

    expect(plan.intent).toBe("decision");
    expect(plan.strategy).toBe("deep");
    expect(plan.queries.length).toBeGreaterThan(1);
    expect(plan.minScore).toBeLessThan(0.4);
  });

  it("packs adjacent results by path and caps duplicate path spam", () => {
    const results: MemorySearchResult[] = [
      {
        path: "memory/notes.md",
        startLine: 10,
        endLine: 12,
        score: 0.81,
        snippet: "alpha",
        source: "memory",
      },
      {
        path: "memory/notes.md",
        startLine: 13,
        endLine: 15,
        score: 0.79,
        snippet: "beta",
        source: "memory",
      },
      {
        path: "memory/notes.md",
        startLine: 50,
        endLine: 51,
        score: 0.6,
        snippet: "gamma",
        source: "memory",
      },
      {
        path: "sessions/run.md",
        startLine: 3,
        endLine: 4,
        score: 0.7,
        snippet: "decision log",
        source: "sessions",
      },
    ];

    const packed = packMemorySearchResults({
      results,
      maxResults: 3,
      perPathLimit: 1,
    });

    expect(packed).toHaveLength(2);
    expect(packed[0]?.path).toBe("memory/notes.md");
    expect(packed[0]?.snippet).toContain("alpha");
    expect(packed[0]?.snippet).toContain("beta");
    expect(packed[1]?.path).toBe("sessions/run.md");
    expect(estimateMemorySearchConfidence(packed)).toBeGreaterThan(0.5);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  __testing,
  addSubagentReportToWorkingSet,
  addToolResultToWorkingSet,
  getWorkingSetStats,
  invalidateWorkingSet,
  searchWorkingSet,
} from "./tool-working-set.js";

const CONFIG = { enabled: true } as const;

describe("tool-working-set", () => {
  beforeEach(() => {
    __testing.WORKING_SET.clear();
  });

  it("indexes read-only tool results for follow-up recall", () => {
    addToolResultToWorkingSet({
      sessionKey: "agent:main:test",
      toolName: "read",
      toolParams: { path: "src/example.ts" },
      result: { content: [{ type: "text", text: "export function addUser() { return true; }" }] },
      config: CONFIG,
    });

    const results = searchWorkingSet({
      sessionKey: "agent:main:test",
      query: "export function adduser() { return true; }",
      maxResults: 3,
      sourceBias: "working-set",
      config: CONFIG,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.path).toBe("src/example.ts");
    expect(results[0]?.source).toBe("working-set");
  });

  it("indexes subagent reports and invalidates the session working set", () => {
    addSubagentReportToWorkingSet({
      sessionKey: "agent:main:test",
      text: "Summary: compacted the prompt and kept active identifiers",
      path: "subagent/research/compaction",
      config: CONFIG,
    });

    expect(getWorkingSetStats("agent:main:test")).toMatchObject({ active: true, entries: 1 });

    const results = searchWorkingSet({
      sessionKey: "agent:main:test",
      query: "active identifiers",
      maxResults: 3,
      config: CONFIG,
    });
    expect(results[0]?.path).toBe("subagent/research/compaction");

    invalidateWorkingSet("agent:main:test");
    expect(getWorkingSetStats("agent:main:test")).toMatchObject({ active: false, entries: 0 });
  });
});

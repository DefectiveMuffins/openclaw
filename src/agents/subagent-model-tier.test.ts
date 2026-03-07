import { describe, expect, it } from "vitest";
import { classifyTaskComplexity } from "./subagent-model-tier.js";

describe("classifyTaskComplexity", () => {
  it("classifies clearly simple tasks as simple", () => {
    expect(classifyTaskComplexity("read file and count lines")).toBe("simple");
  });

  it("classifies implementation tasks as complex", () => {
    expect(classifyTaskComplexity("implement a new caching layer")).toBe("complex");
  });

  it("defaults to complex when uncertain", () => {
    expect(classifyTaskComplexity("handle this")).toBe("complex");
  });
});

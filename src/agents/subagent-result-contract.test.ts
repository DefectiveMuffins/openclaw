import { describe, expect, it } from "vitest";
import {
  buildDelegationContractPromptLines,
  getSubagentReportWorkingSetText,
  parseStructuredSubagentResult,
} from "./subagent-result-contract.js";

describe("subagent-result-contract", () => {
  it("parses structured JSON results and formats them for the working set", () => {
    const input = `\`\`\`json
{
  "summary": "Found the cache invalidation bug",
  "evidence": ["write tool cleared cache", "working set was left intact"],
  "uncertainties": ["need broader e2e validation"],
  "confidence": 0.82,
  "recommendedNextStep": "run the focused regression suite"
}
\`\`\``;

    const parsed = parseStructuredSubagentResult(input);
    expect(parsed).toMatchObject({
      summary: "Found the cache invalidation bug",
      confidence: 0.82,
    });

    const workingSetText = getSubagentReportWorkingSetText(input);
    expect(workingSetText).toContain("Summary: Found the cache invalidation bug");
    expect(workingSetText).toContain("Evidence 1: write tool cleared cache");
    expect(workingSetText).toContain("Recommended next step: run the focused regression suite");
  });

  it("builds delegation contract prompt lines for structured workers", () => {
    const lines = buildDelegationContractPromptLines({
      role: "research",
      deliverable: "Return the regression cause and fix scope",
      acceptance: ["cite the touched file", "call out remaining risks"],
      responseFormat: "structured",
    });

    expect(lines.join("\n")).toContain("## Delegation Contract");
    expect(lines.join("\n")).toContain("Role: research");
    expect(lines.join("\n")).toContain("Return the regression cause and fix scope");
    expect(lines.join("\n")).toContain('"summary": "short result summary"');
  });
});

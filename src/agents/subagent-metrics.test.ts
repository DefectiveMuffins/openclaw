import { describe, expect, it } from "vitest";
import { summarizeDelegationReportMetrics } from "./subagent-metrics.ts";

describe("summarizeDelegationReportMetrics", () => {
  it("returns null when there is no usable report text", () => {
    expect(summarizeDelegationReportMetrics(" ")).toBeNull();
    expect(summarizeDelegationReportMetrics("(no output)")).toBeNull();
  });

  it("counts plain-text reports without structured conflict signals", () => {
    expect(summarizeDelegationReportMetrics("finished reviewing the cache path")).toEqual({
      delegationReports: 1,
    });
  });

  it("flags structured conflict signals from disagreement-style findings", () => {
    const findings = `
{
  "summary": "Two subagents disagree on the invalidation order.",
  "evidence": ["reader says writes happen first"],
  "uncertainties": ["conflicting traces from staging"],
  "confidence": 0.42,
  "recommendedNextStep": "reconcile the mismatch with a focused trace"
}
`;

    expect(summarizeDelegationReportMetrics(findings)).toEqual({
      delegationReports: 1,
      structuredDelegationReports: 1,
      delegationConflictSignals: 1,
    });
  });
});

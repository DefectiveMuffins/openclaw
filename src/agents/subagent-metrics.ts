import type { SessionDelegationCounterDelta } from "./agentic-counters.js";
import { parseStructuredSubagentResult } from "./subagent-result-contract.js";

const CONFLICT_SIGNAL_RE =
  /\b(conflict(?:ing)?|contradict(?:ion|ory)?|disagree(?:ment)?|inconsistent|mismatch|diverg(?:e|ent|ence))\b/i;

export function summarizeDelegationReportMetrics(
  findings: string,
): SessionDelegationCounterDelta | null {
  const trimmed = findings.trim();
  if (!trimmed || trimmed === "(no output)") {
    return null;
  }

  const parsed = parseStructuredSubagentResult(trimmed);
  if (!parsed) {
    return { delegationReports: 1 };
  }

  const signalText = [
    parsed.summary,
    ...parsed.evidence,
    ...parsed.uncertainties,
    parsed.recommendedNextStep,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");

  return {
    delegationReports: 1,
    structuredDelegationReports: 1,
    delegationConflictSignals: CONFLICT_SIGNAL_RE.test(signalText) ? 1 : 0,
  };
}

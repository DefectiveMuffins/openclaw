import type {
  SessionAgentRoutingSummary,
  SessionAgenticCounters,
} from "../config/sessions/types.js";

export type SessionDelegationCounterDelta = {
  delegationReports?: number;
  structuredDelegationReports?: number;
  delegationConflictSignals?: number;
};

function normalizeCounter(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export function applyRoutingSummaryToAgenticCounters(
  current: SessionAgenticCounters | undefined,
  routing: SessionAgentRoutingSummary | null | undefined,
  now = Date.now(),
): SessionAgenticCounters | undefined {
  if (!routing) {
    return current;
  }
  return {
    ...current,
    routedRuns: normalizeCounter(current?.routedRuns) + 1,
    cheapPathRuns: normalizeCounter(current?.cheapPathRuns) + (routing.cheapPath ? 1 : 0),
    escalations: normalizeCounter(current?.escalations) + (routing.escalated ? 1 : 0),
    updatedAt: now,
  };
}

export function applyDelegationDeltaToAgenticCounters(
  current: SessionAgenticCounters | undefined,
  delta: SessionDelegationCounterDelta | null | undefined,
  now = Date.now(),
): SessionAgenticCounters | undefined {
  if (!delta) {
    return current;
  }
  const delegationReports = normalizeCounter(delta.delegationReports);
  const structuredDelegationReports = normalizeCounter(delta.structuredDelegationReports);
  const delegationConflictSignals = normalizeCounter(delta.delegationConflictSignals);
  if (
    delegationReports === 0 &&
    structuredDelegationReports === 0 &&
    delegationConflictSignals === 0
  ) {
    return current;
  }
  return {
    ...current,
    delegationReports: normalizeCounter(current?.delegationReports) + delegationReports,
    structuredDelegationReports:
      normalizeCounter(current?.structuredDelegationReports) + structuredDelegationReports,
    delegationConflictSignals:
      normalizeCounter(current?.delegationConflictSignals) + delegationConflictSignals,
    updatedAt: now,
  };
}

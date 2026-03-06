import type { SessionRef } from "../logging/diagnostic-session-state.js";
import { getDiagnosticSessionState } from "../logging/diagnostic-session-state.js";
import { isAcpSessionKey, isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";

const MAX_TRACKED_CHILD_SESSION_KEYS = 32;

export function shouldForceTopLevelDelegation(sessionKey?: string): boolean {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return false;
  }
  if (
    isSubagentSessionKey(normalized) ||
    isCronSessionKey(normalized) ||
    isAcpSessionKey(normalized)
  ) {
    return false;
  }
  return true;
}

export function resetDelegationTracking(ref: SessionRef): void {
  const state = getDiagnosticSessionState(ref);
  state.delegation = {
    spawnedSubagentCount: 0,
    childSessionKeys: [],
  };
}

export function recordDelegatedSubagentSpawn(
  ref: SessionRef,
  childSessionKey?: string | null,
): void {
  const state = getDiagnosticSessionState(ref);
  if (!state.delegation) {
    state.delegation = {
      spawnedSubagentCount: 0,
      childSessionKeys: [],
    };
  }
  state.delegation.spawnedSubagentCount += 1;
  const trimmedChildKey = childSessionKey?.trim();
  if (!trimmedChildKey) {
    return;
  }
  const childSessionKeys = state.delegation.childSessionKeys ?? [];
  if (childSessionKeys.includes(trimmedChildKey)) {
    state.delegation.childSessionKeys = childSessionKeys;
    return;
  }
  childSessionKeys.push(trimmedChildKey);
  if (childSessionKeys.length > MAX_TRACKED_CHILD_SESSION_KEYS) {
    childSessionKeys.splice(0, childSessionKeys.length - MAX_TRACKED_CHILD_SESSION_KEYS);
  }
  state.delegation.childSessionKeys = childSessionKeys;
}

export function getDelegationTracking(ref: SessionRef): {
  spawnedSubagentCount: number;
  childSessionKeys: string[];
} {
  const state = getDiagnosticSessionState(ref);
  return {
    spawnedSubagentCount: Math.max(0, state.delegation?.spawnedSubagentCount ?? 0),
    childSessionKeys: [...(state.delegation?.childSessionKeys ?? [])],
  };
}

export function isAcceptedSubagentSpawnResult(result: unknown): result is {
  status: "accepted";
  childSessionKey?: string;
} {
  if (!result || typeof result !== "object") {
    return false;
  }
  const typedResult = result as { status?: unknown; childSessionKey?: unknown };
  if (typedResult.status !== "accepted") {
    return false;
  }
  return (
    typedResult.childSessionKey === undefined || typeof typedResult.childSessionKey === "string"
  );
}

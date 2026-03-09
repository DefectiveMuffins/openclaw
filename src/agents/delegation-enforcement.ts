import type { OpenClawConfig } from "../config/config.js";
import type { SessionRef } from "../logging/diagnostic-session-state.js";
import { getDiagnosticSessionState } from "../logging/diagnostic-session-state.js";
import { isAcpSessionKey, isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import type { AgentInternalEvent } from "./internal-events.js";

const MAX_TRACKED_CHILD_SESSION_KEYS = 32;

export const DELEGATION_MODES = ["off", "soft", "hard"] as const;
export type DelegationMode = (typeof DELEGATION_MODES)[number];

export const DELEGATION_SCOPES = ["all", "action_only"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];

const DEFAULT_DELEGATION_MODE: DelegationMode = "soft";
const DEFAULT_DELEGATION_SCOPE: DelegationScope = "all";

const ACTION_ONLY_PROMPT_RE =
  /(\b(run|test|build|fix|debug|implement|edit|write|refactor|search|inspect|investigate|analyze|compare|summarize|verify|read|list|show|create|update|delete|deploy|install)\b|`[^`]+`|\/\w+)/i;

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

export function resolveDelegationMode(cfg?: OpenClawConfig): DelegationMode {
  const raw = cfg?.agents?.defaults?.subagents?.delegation?.mode;
  if (raw === "off" || raw === "soft" || raw === "hard") {
    return raw;
  }
  return DEFAULT_DELEGATION_MODE;
}

export function resolveDelegationScope(cfg?: OpenClawConfig): DelegationScope {
  const raw = cfg?.agents?.defaults?.subagents?.delegation?.scope;
  if (raw === "all" || raw === "action_only") {
    return raw;
  }
  return DEFAULT_DELEGATION_SCOPE;
}

export function isActionOnlyDelegationPrompt(prompt?: string): boolean {
  const normalized = prompt?.trim();
  if (!normalized) {
    return false;
  }
  return ACTION_ONLY_PROMPT_RE.test(normalized);
}

export function resolveTopLevelDelegationPolicy(params: {
  config?: OpenClawConfig;
  sessionKey?: string;
  prompt?: string;
  delegationRequired?: boolean;
}): {
  topLevel: boolean;
  mode: DelegationMode;
  scope: DelegationScope;
  requiresDelegation: boolean;
  forcedToolProfile?: "orchestrator" | "manager";
} {
  const topLevel = shouldForceTopLevelDelegation(params.sessionKey);
  const mode = resolveDelegationMode(params.config);
  const scope = resolveDelegationScope(params.config);

  if (!topLevel || mode === "off") {
    return {
      topLevel,
      mode,
      scope,
      requiresDelegation: false,
    };
  }

  const requiresDelegation =
    scope === "all"
      ? true
      : (params.delegationRequired ?? isActionOnlyDelegationPrompt(params.prompt));

  return {
    topLevel,
    mode,
    scope,
    requiresDelegation,
    forcedToolProfile: requiresDelegation
      ? mode === "hard"
        ? "manager"
        : "orchestrator"
      : undefined,
  };
}

function ensureDelegationState(ref: SessionRef) {
  const state = getDiagnosticSessionState(ref);
  if (!state.delegation) {
    state.delegation = {
      spawnedSubagentCount: 0,
      childSessionKeys: [],
      waitingForCompletions: false,
      expectedChildSessionKeys: [],
      completedChildSessionKeys: [],
      matchedCompletionCount: 0,
    };
  }
  return state.delegation;
}

function normalizeSessionKeyList(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

export function resetDelegationTracking(ref: SessionRef): void {
  const state = getDiagnosticSessionState(ref);
  state.delegation = {
    spawnedSubagentCount: 0,
    childSessionKeys: [],
    waitingForCompletions: false,
    expectedChildSessionKeys: [],
    completedChildSessionKeys: [],
    matchedCompletionCount: 0,
  };
}

export function markDelegationWaitingForCompletions(
  ref: SessionRef,
  expectedChildSessionKeys?: string[],
): void {
  const delegation = ensureDelegationState(ref);
  const expected = normalizeSessionKeyList(
    expectedChildSessionKeys ?? delegation.childSessionKeys ?? [],
  );
  const completed = normalizeSessionKeyList(delegation.completedChildSessionKeys ?? []);
  const matchedFromCompleted =
    expected.length === 0
      ? completed.length
      : expected.reduce((count, key) => (completed.includes(key) ? count + 1 : count), 0);

  delegation.waitingForCompletions = true;
  delegation.expectedChildSessionKeys = expected;
  delegation.completedChildSessionKeys = completed;
  delegation.matchedCompletionCount = Math.max(
    matchedFromCompleted,
    delegation.matchedCompletionCount ?? 0,
  );
}

export function clearDelegationWaitingForCompletions(ref: SessionRef): void {
  const delegation = ensureDelegationState(ref);
  delegation.waitingForCompletions = false;
  delegation.expectedChildSessionKeys = [];
  delegation.completedChildSessionKeys = [];
  delegation.matchedCompletionCount = 0;
}

export function recordDelegatedSubagentSpawn(
  ref: SessionRef,
  childSessionKey?: string | null,
): void {
  const delegation = ensureDelegationState(ref);
  delegation.spawnedSubagentCount += 1;
  const trimmedChildKey = childSessionKey?.trim();
  if (!trimmedChildKey) {
    return;
  }
  const childSessionKeys = delegation.childSessionKeys ?? [];
  if (childSessionKeys.includes(trimmedChildKey)) {
    delegation.childSessionKeys = childSessionKeys;
    return;
  }
  childSessionKeys.push(trimmedChildKey);
  if (childSessionKeys.length > MAX_TRACKED_CHILD_SESSION_KEYS) {
    childSessionKeys.splice(0, childSessionKeys.length - MAX_TRACKED_CHILD_SESSION_KEYS);
  }
  delegation.childSessionKeys = childSessionKeys;
}

export function recordDelegatedTaskCompletion(
  ref: SessionRef,
  childSessionKey?: string | null,
): void {
  const delegation = ensureDelegationState(ref);

  const expected = delegation.expectedChildSessionKeys ?? [];
  const completed = delegation.completedChildSessionKeys ?? [];
  const trimmedChildKey = childSessionKey?.trim();

  if (!delegation.waitingForCompletions) {
    if (trimmedChildKey && !completed.includes(trimmedChildKey)) {
      completed.push(trimmedChildKey);
      delegation.completedChildSessionKeys = completed;
    }
    delegation.lastCompletionAt = Date.now();
    return;
  }

  if (trimmedChildKey) {
    if (completed.includes(trimmedChildKey)) {
      return;
    }
    completed.push(trimmedChildKey);
    delegation.completedChildSessionKeys = completed;
    if (expected.length === 0 || expected.includes(trimmedChildKey)) {
      delegation.matchedCompletionCount = Math.max(0, delegation.matchedCompletionCount ?? 0) + 1;
    }
  } else if (expected.length === 0) {
    delegation.matchedCompletionCount = Math.max(0, delegation.matchedCompletionCount ?? 0) + 1;
  }

  delegation.lastCompletionAt = Date.now();
}

export function recordDelegatedTaskCompletionEvent(
  ref: SessionRef,
  event: AgentInternalEvent,
): void {
  if (event.type !== "task_completion" || event.source !== "subagent") {
    return;
  }
  recordDelegatedTaskCompletion(ref, event.childSessionKey);
}

export function getDelegationTracking(ref: SessionRef): {
  spawnedSubagentCount: number;
  childSessionKeys: string[];
  waitingForCompletions: boolean;
  expectedChildSessionKeys: string[];
  completedChildSessionKeys: string[];
  matchedCompletionCount: number;
} {
  const state = getDiagnosticSessionState(ref);
  return {
    spawnedSubagentCount: Math.max(0, state.delegation?.spawnedSubagentCount ?? 0),
    childSessionKeys: [...(state.delegation?.childSessionKeys ?? [])],
    waitingForCompletions: state.delegation?.waitingForCompletions === true,
    expectedChildSessionKeys: [...(state.delegation?.expectedChildSessionKeys ?? [])],
    completedChildSessionKeys: [...(state.delegation?.completedChildSessionKeys ?? [])],
    matchedCompletionCount: Math.max(0, state.delegation?.matchedCompletionCount ?? 0),
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

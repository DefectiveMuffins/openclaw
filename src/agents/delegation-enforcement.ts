import type { OpenClawConfig } from "../config/config.js";
import type { SessionRef } from "../logging/diagnostic-session-state.js";
import { getDiagnosticSessionState } from "../logging/diagnostic-session-state.js";
import { isAcpSessionKey, isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import {
  isTaskCompletionFollowUpInputProvenance,
  type InputProvenance,
} from "../sessions/input-provenance.js";
import type { AgentInternalEvent } from "./internal-events.js";

const MAX_TRACKED_CHILD_SESSION_KEYS = 32;
const MAX_TRACKED_COMPLETIONS = 64;
const MAX_TRACKED_CHILD_SPAWNS = 64;
const MAX_CORRECTIVE_RETRIES = 2;
const INTERNAL_SYSTEM_INPUT_PROVENANCE_KIND = "internal_system";

export const DELEGATION_MODES = ["off", "soft", "hard"] as const;
export type DelegationMode = (typeof DELEGATION_MODES)[number];

export const DELEGATION_SCOPES = ["all", "action_only"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];

type DelegationReviewDecision = "accept" | "reject";
type DelegationReviewNextAction = "same_model_retry" | "switch_model_retry" | "final_failure";
type DelegationCorrectiveAction = "same_model_retry" | "switch_model_retry";
type DelegatedTaskStatus = "ok" | "timeout" | "error" | "unknown";

type DelegatedCompletionRecord = {
  id: number;
  childSessionKey?: string;
  status: DelegatedTaskStatus;
  statusLabel: string;
  workerModel?: string;
  role?: string;
  deliverable?: string;
  acceptanceCriteria?: string[];
  responseFormat?: string;
  structuredResult?: unknown;
  malformedStructuredResult?: boolean;
  reviewed?: boolean;
  decision?: DelegationReviewDecision;
  nextAction?: DelegationReviewNextAction;
  reason?: string;
  createdAt: number;
};

type DelegatedChildSpawnRecord = {
  childSessionKey: string;
  model?: string;
  spawnedAt: number;
  isCorrective?: boolean;
  correctiveAttempt?: number;
  awaitingCompletion?: boolean;
};

type DelegationPendingCorrectiveAction = {
  requiredAction: DelegationCorrectiveAction;
  rejectedChildSessionKey: string;
  rejectedModel?: string;
  rejectedCompletionId: number;
  createdAt: number;
};

const DEFAULT_DELEGATION_MODE: DelegationMode = "soft";
const DEFAULT_DELEGATION_SCOPE: DelegationScope = "action_only";

const ACTION_ONLY_PROMPT_RE =
  /(\b(run|test|build|fix|debug|implement|edit|write|refactor|search|inspect|investigate|analyze|compare|summarize|verify|read|list|show|create|update|delete|deploy|install)\b|`[^`]+`|\/\w+)/i;

function normalizeModelRefValue(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeStatus(value: unknown): DelegatedTaskStatus {
  if (value === "ok" || value === "timeout" || value === "error" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function normalizeStringList(values?: unknown): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value): value is string => Boolean(value));
  return normalized.length > 0 ? normalized : undefined;
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
      nextCompletionId: 1,
      completions: [],
      acceptedCompletionCount: 0,
      rejectedCompletionCount: 0,
      correctiveRetryCount: 0,
      childSpawns: [],
      finalFailureRequested: false,
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

function findChildSpawnBySessionKey(params: {
  childSpawns: DelegatedChildSpawnRecord[];
  childSessionKey?: string;
}): DelegatedChildSpawnRecord | undefined {
  const childSessionKey = params.childSessionKey?.trim();
  if (!childSessionKey) {
    return undefined;
  }
  for (let i = params.childSpawns.length - 1; i >= 0; i -= 1) {
    const candidate = params.childSpawns[i];
    if (candidate.childSessionKey === childSessionKey) {
      return candidate;
    }
  }
  return undefined;
}

function doesModelSatisfyCorrectiveAction(params: {
  requiredAction: DelegationCorrectiveAction;
  rejectedModel?: string;
  candidateModel?: string;
}): boolean {
  const rejectedModel = normalizeModelRefValue(params.rejectedModel);
  const candidateModel = normalizeModelRefValue(params.candidateModel);

  if (!candidateModel) {
    return false;
  }
  if (!rejectedModel) {
    return true;
  }

  if (params.requiredAction === "same_model_retry") {
    return candidateModel === rejectedModel;
  }
  return candidateModel !== rejectedModel;
}

function appendDelegatedCompletion(
  state: ReturnType<typeof ensureDelegationState>,
  completion: DelegatedCompletionRecord,
): void {
  const completions = state.completions ?? [];
  completions.push(completion);
  if (completions.length > MAX_TRACKED_COMPLETIONS) {
    completions.splice(0, completions.length - MAX_TRACKED_COMPLETIONS);
  }
  state.completions = completions;
}

function appendDelegatedChildSpawn(
  state: ReturnType<typeof ensureDelegationState>,
  spawn: DelegatedChildSpawnRecord,
): void {
  const childSpawns = state.childSpawns ?? [];
  childSpawns.push(spawn);
  if (childSpawns.length > MAX_TRACKED_CHILD_SPAWNS) {
    childSpawns.splice(0, childSpawns.length - MAX_TRACKED_CHILD_SPAWNS);
  }
  state.childSpawns = childSpawns;
}

function normalizeCompletionStatusLabel(params: {
  status: DelegatedTaskStatus;
  statusLabel?: string;
}): string {
  const statusLabel = params.statusLabel?.trim();
  if (statusLabel) {
    return statusLabel;
  }
  if (params.status === "ok") {
    return "completed successfully";
  }
  if (params.status === "error") {
    return "failed";
  }
  if (params.status === "timeout") {
    return "timed out";
  }
  return "unknown";
}

function recordDelegatedTaskCompletionWithDetails(
  ref: SessionRef,
  details: {
    childSessionKey?: string | null;
    status?: DelegatedTaskStatus;
    statusLabel?: string;
    workerModel?: string;
    role?: string;
    deliverable?: string;
    acceptanceCriteria?: string[];
    responseFormat?: string;
    structuredResult?: unknown;
    malformedStructuredResult?: boolean;
  },
): void {
  const delegation = ensureDelegationState(ref);

  const expected = delegation.expectedChildSessionKeys ?? [];
  const completed = delegation.completedChildSessionKeys ?? [];
  const trimmedChildKey = details.childSessionKey?.trim();

  let shouldRecordCompletion = false;

  if (!delegation.waitingForCompletions) {
    if (trimmedChildKey && !completed.includes(trimmedChildKey)) {
      completed.push(trimmedChildKey);
      delegation.completedChildSessionKeys = completed;
      shouldRecordCompletion = true;
    }
    delegation.lastCompletionAt = Date.now();
    if (!shouldRecordCompletion) {
      return;
    }
  } else {
    if (trimmedChildKey) {
      if (completed.includes(trimmedChildKey)) {
        return;
      }
      completed.push(trimmedChildKey);
      delegation.completedChildSessionKeys = completed;
      if (expected.length === 0 || expected.includes(trimmedChildKey)) {
        delegation.matchedCompletionCount = Math.max(0, delegation.matchedCompletionCount ?? 0) + 1;
        shouldRecordCompletion = true;
      }
    } else if (expected.length === 0) {
      delegation.matchedCompletionCount = Math.max(0, delegation.matchedCompletionCount ?? 0) + 1;
      shouldRecordCompletion = true;
    }

    delegation.lastCompletionAt = Date.now();
    if (!shouldRecordCompletion) {
      return;
    }
  }

  const childSpawns = delegation.childSpawns ?? [];
  const spawn = findChildSpawnBySessionKey({
    childSpawns,
    childSessionKey: trimmedChildKey,
  });
  if (spawn) {
    spawn.awaitingCompletion = false;
  }

  const completionId = Math.max(1, delegation.nextCompletionId ?? 1);
  delegation.nextCompletionId = completionId + 1;

  const status = normalizeStatus(details.status);
  const statusLabel = normalizeCompletionStatusLabel({
    status,
    statusLabel: details.statusLabel,
  });

  appendDelegatedCompletion(delegation, {
    id: completionId,
    childSessionKey: trimmedChildKey,
    status,
    statusLabel,
    workerModel:
      normalizeModelRefValue(details.workerModel) ?? normalizeModelRefValue(spawn?.model),
    role: details.role?.trim() || undefined,
    deliverable: details.deliverable?.trim() || undefined,
    acceptanceCriteria: normalizeStringList(details.acceptanceCriteria),
    responseFormat: details.responseFormat?.trim() || undefined,
    structuredResult: details.structuredResult,
    malformedStructuredResult: details.malformedStructuredResult === true,
    reviewed: false,
    createdAt: Date.now(),
  });
}

function findUnreviewedCompletionByChildSessionKey(params: {
  completions: DelegatedCompletionRecord[];
  childSessionKey: string;
}): DelegatedCompletionRecord | undefined {
  for (let index = params.completions.length - 1; index >= 0; index -= 1) {
    const completion = params.completions[index];
    if (completion.reviewed === true) {
      continue;
    }
    if (completion.childSessionKey !== params.childSessionKey) {
      continue;
    }
    return completion;
  }
  return undefined;
}

function completionIsObjectivelyInadequate(completion: DelegatedCompletionRecord): boolean {
  if (completion.status === "error" || completion.status === "timeout") {
    return true;
  }
  if (completion.malformedStructuredResult === true) {
    return true;
  }
  return false;
}

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
  inputProvenance?: InputProvenance;
}): {
  topLevel: boolean;
  mode: DelegationMode;
  scope: DelegationScope;
  requiresDelegation: boolean;
  forcedToolProfile?: "orchestrator" | "manager";
  resumeExistingDelegation: boolean;
} {
  const topLevel = shouldForceTopLevelDelegation(params.sessionKey);
  const mode = resolveDelegationMode(params.config);
  const scope = resolveDelegationScope(params.config);
  const resumeExistingDelegation = isTaskCompletionFollowUpInputProvenance(
    params.inputProvenance,
  );

  if (!topLevel || mode === "off") {
    return {
      topLevel,
      mode,
      scope,
      requiresDelegation: false,
      resumeExistingDelegation: false,
    };
  }

  if (params.inputProvenance?.kind === INTERNAL_SYSTEM_INPUT_PROVENANCE_KIND) {
    return {
      topLevel,
      mode,
      scope,
      requiresDelegation: false,
      resumeExistingDelegation: false,
    };
  }

  const requiresDelegation =
    resumeExistingDelegation
      ? true
      : scope === "all"
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
    resumeExistingDelegation,
  };
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
    nextCompletionId: 1,
    completions: [],
    acceptedCompletionCount: 0,
    rejectedCompletionCount: 0,
    correctiveRetryCount: 0,
    childSpawns: [],
    pendingCorrectiveAction: undefined,
    finalFailureRequested: false,
    lastCompletionAt: undefined,
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

export function validateDelegatedCorrectiveSpawn(
  ref: SessionRef,
  params: {
    model?: string;
  },
):
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    } {
  const delegation = ensureDelegationState(ref);
  const unreviewedCompletionCount = (delegation.completions ?? []).reduce(
    (count, completion) => (completion.reviewed === true ? count : count + 1),
    0,
  );
  if (unreviewedCompletionCount > 0) {
    return {
      ok: false,
      error:
        "Review required: call subagent_review for every completed worker result before spawning additional workers.",
    };
  }

  const pending = delegation.pendingCorrectiveAction;
  if (pending) {
    const candidateModel = normalizeModelRefValue(params.model);
    if (!candidateModel) {
      return {
        ok: false,
        error:
          "Hard delegation corrective retry requires an explicit sessions_spawn.model chosen from models_list.",
      };
    }

    if (
      !doesModelSatisfyCorrectiveAction({
        requiredAction: pending.requiredAction,
        rejectedModel: pending.rejectedModel,
        candidateModel,
      })
    ) {
      if (pending.requiredAction === "same_model_retry") {
        return {
          ok: false,
          error:
            "Corrective retry requires the same model as the rejected worker result (nextAction=same_model_retry).",
        };
      }
      return {
        ok: false,
        error:
          "Corrective retry requires a different model from the rejected worker result (nextAction=switch_model_retry).",
      };
    }

    return { ok: true };
  }

  const acceptedCompletionCount = Math.max(0, delegation.acceptedCompletionCount ?? 0);
  const correctiveRetryCount = Math.max(0, delegation.correctiveRetryCount ?? 0);
  if (delegation.finalFailureRequested === true && acceptedCompletionCount <= 0) {
    return {
      ok: false,
      error:
        "final_failure has already been selected for this turn. Provide a failure-oriented final answer instead of spawning more workers.",
    };
  }
  if (correctiveRetryCount >= MAX_CORRECTIVE_RETRIES && acceptedCompletionCount <= 0) {
    return {
      ok: false,
      error:
        "Corrective retry budget is exhausted (2). Use subagent_review with nextAction=final_failure and provide a failure-oriented final answer.",
    };
  }

  return { ok: true };
}

export function recordDelegatedSubagentSpawn(
  ref: SessionRef,
  childSessionKey?: string | null,
  params?: {
    model?: string;
  },
): void {
  const delegation = ensureDelegationState(ref);
  delegation.spawnedSubagentCount += 1;

  const trimmedChildKey = childSessionKey?.trim();
  if (!trimmedChildKey) {
    return;
  }

  const childSessionKeys = delegation.childSessionKeys ?? [];
  if (!childSessionKeys.includes(trimmedChildKey)) {
    childSessionKeys.push(trimmedChildKey);
    if (childSessionKeys.length > MAX_TRACKED_CHILD_SESSION_KEYS) {
      childSessionKeys.splice(0, childSessionKeys.length - MAX_TRACKED_CHILD_SESSION_KEYS);
    }
  }
  delegation.childSessionKeys = childSessionKeys;

  const childSpawns = delegation.childSpawns ?? [];
  const existingSpawn = findChildSpawnBySessionKey({
    childSpawns,
    childSessionKey: trimmedChildKey,
  });
  const normalizedModel = normalizeModelRefValue(params?.model);

  if (existingSpawn) {
    existingSpawn.awaitingCompletion = true;
    if (normalizedModel) {
      existingSpawn.model = normalizedModel;
    }
  } else {
    appendDelegatedChildSpawn(delegation, {
      childSessionKey: trimmedChildKey,
      model: normalizedModel,
      spawnedAt: Date.now(),
      awaitingCompletion: true,
    });
  }

  const pending = delegation.pendingCorrectiveAction;
  if (pending) {
    const candidateModel = normalizedModel ?? existingSpawn?.model;
    if (
      doesModelSatisfyCorrectiveAction({
        requiredAction: pending.requiredAction,
        rejectedModel: pending.rejectedModel,
        candidateModel,
      })
    ) {
      const spawnRecord =
        findChildSpawnBySessionKey({
          childSpawns: delegation.childSpawns ?? [],
          childSessionKey: trimmedChildKey,
        }) ?? existingSpawn;
      if (spawnRecord) {
        spawnRecord.isCorrective = true;
        spawnRecord.correctiveAttempt = Math.max(1, delegation.correctiveRetryCount ?? 1);
      }
      delegation.pendingCorrectiveAction = undefined;
    }
  }
}

export function recordDelegatedTaskCompletion(
  ref: SessionRef,
  childSessionKey?: string | null,
): void {
  recordDelegatedTaskCompletionWithDetails(ref, {
    childSessionKey,
    status: "unknown",
  });
}

export function recordDelegatedTaskCompletionEvent(
  ref: SessionRef,
  event: AgentInternalEvent,
): void {
  if (event.type !== "task_completion" || event.source !== "subagent") {
    return;
  }
  recordDelegatedTaskCompletionWithDetails(ref, {
    childSessionKey: event.childSessionKey,
    status: event.status,
    statusLabel: event.statusLabel,
    workerModel: event.workerModel,
    role: event.role,
    deliverable: event.deliverable,
    acceptanceCriteria: event.acceptanceCriteria,
    responseFormat: event.responseFormat,
    structuredResult: event.structuredResult,
    malformedStructuredResult: event.malformedStructuredResult,
  });
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

export type DelegationReviewState = {
  completionCount: number;
  unreviewedCompletionCount: number;
  acceptedCompletionCount: number;
  rejectedCompletionCount: number;
  correctiveRetryCount: number;
  activeCorrectiveWorkerCount: number;
  pendingCorrectiveAction?: DelegationCorrectiveAction;
  pendingCorrectiveRejectedModel?: string;
  finalFailureRequested: boolean;
};

export function getDelegationReviewState(ref: SessionRef): DelegationReviewState {
  const delegation = ensureDelegationState(ref);
  const completions = delegation.completions ?? [];
  const unreviewedCompletionCount = completions.reduce(
    (count, completion) => (completion.reviewed === true ? count : count + 1),
    0,
  );
  const childSpawns = delegation.childSpawns ?? [];
  const activeCorrectiveWorkerCount = childSpawns.reduce((count, spawn) => {
    if (spawn.isCorrective !== true) {
      return count;
    }
    if (spawn.awaitingCompletion === false) {
      return count;
    }
    return count + 1;
  }, 0);

  return {
    completionCount: completions.length,
    unreviewedCompletionCount,
    acceptedCompletionCount: Math.max(0, delegation.acceptedCompletionCount ?? 0),
    rejectedCompletionCount: Math.max(0, delegation.rejectedCompletionCount ?? 0),
    correctiveRetryCount: Math.max(0, delegation.correctiveRetryCount ?? 0),
    activeCorrectiveWorkerCount,
    pendingCorrectiveAction: delegation.pendingCorrectiveAction?.requiredAction,
    pendingCorrectiveRejectedModel: delegation.pendingCorrectiveAction?.rejectedModel,
    finalFailureRequested: delegation.finalFailureRequested === true,
  };
}

export function recordDelegatedSubagentReview(
  ref: SessionRef,
  review: {
    childSessionKey: string;
    decision: DelegationReviewDecision;
    reason?: string;
    nextAction?: DelegationReviewNextAction;
  },
):
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    } {
  const childSessionKey = review.childSessionKey.trim();
  if (!childSessionKey) {
    return { ok: false, error: "childSessionKey is required" };
  }

  const decision = review.decision;
  if (decision !== "accept" && decision !== "reject") {
    return {
      ok: false,
      error: "invalid decision: " + String(review.decision),
    };
  }

  const delegation = ensureDelegationState(ref);
  const completions = delegation.completions ?? [];
  const completion = findUnreviewedCompletionByChildSessionKey({
    completions,
    childSessionKey,
  });

  if (!completion) {
    return {
      ok: false,
      error: `No unreviewed completion is available for child session ${childSessionKey}.`,
    };
  }

  const reviewReason = review.reason?.trim() || undefined;

  if (decision === "accept") {
    if (completionIsObjectivelyInadequate(completion)) {
      return {
        ok: false,
        error:
          "Cannot accept an objectively inadequate completion (error/timeout/malformed structured output). Reject it with a retry or final_failure action.",
      };
    }
    completion.reviewed = true;
    completion.decision = decision;
    completion.reason = reviewReason;
    completion.nextAction = undefined;
    delegation.acceptedCompletionCount = Math.max(0, delegation.acceptedCompletionCount ?? 0) + 1;
    delegation.pendingCorrectiveAction = undefined;
    delegation.finalFailureRequested = false;
    return { ok: true };
  }

  const nextAction = review.nextAction;
  if (
    nextAction !== "same_model_retry" &&
    nextAction !== "switch_model_retry" &&
    nextAction !== "final_failure"
  ) {
    return {
      ok: false,
      error: "nextAction is required when decision=reject",
    };
  }

  const retriesUsed = Math.max(0, delegation.correctiveRetryCount ?? 0);
  if (nextAction !== "final_failure") {
    if (retriesUsed >= MAX_CORRECTIVE_RETRIES) {
      return {
        ok: false,
        error:
          "Corrective retry budget is exhausted (2). Use nextAction=final_failure and provide a failure-oriented final answer.",
      };
    }
    if (retriesUsed >= 1 && nextAction !== "switch_model_retry") {
      return {
        ok: false,
        error:
          "Second corrective retry must switch models. Use nextAction=switch_model_retry or nextAction=final_failure.",
      };
    }
  }

  completion.reviewed = true;
  completion.decision = decision;
  completion.reason = reviewReason;
  completion.nextAction = nextAction;
  delegation.rejectedCompletionCount = Math.max(0, delegation.rejectedCompletionCount ?? 0) + 1;

  if (nextAction === "final_failure") {
    delegation.finalFailureRequested = true;
    delegation.pendingCorrectiveAction = undefined;
    return { ok: true };
  }

  delegation.correctiveRetryCount = retriesUsed + 1;
  delegation.pendingCorrectiveAction = {
    requiredAction: nextAction,
    rejectedChildSessionKey: childSessionKey,
    rejectedModel: normalizeModelRefValue(completion.workerModel),
    rejectedCompletionId: completion.id,
    createdAt: Date.now(),
  };
  delegation.finalFailureRequested = false;
  return { ok: true };
}

export function isAcceptedSubagentSpawnResult(result: unknown): result is {
  status: "accepted";
  childSessionKey?: string;
  model?: string;
} {
  if (!result || typeof result !== "object") {
    return false;
  }
  const typedResult = result as { status?: unknown; childSessionKey?: unknown; model?: unknown };
  if (typedResult.status !== "accepted") {
    return false;
  }
  return (
    (typedResult.childSessionKey === undefined ||
      typeof typedResult.childSessionKey === "string") &&
    (typedResult.model === undefined || typeof typedResult.model === "string")
  );
}

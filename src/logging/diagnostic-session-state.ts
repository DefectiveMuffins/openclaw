export type SessionStateValue = "idle" | "processing" | "waiting";

export type SessionState = {
  sessionId?: string;
  sessionKey?: string;
  lastActivity: number;
  state: SessionStateValue;
  queueDepth: number;
  toolCallHistory?: ToolCallRecord[];
  toolLoopWarningBuckets?: Map<string, number>;
  commandPollCounts?: Map<string, { count: number; lastPollAt: number }>;
  delegation?: {
    spawnedSubagentCount: number;
    childSessionKeys?: string[];
    waitingForCompletions?: boolean;
    expectedChildSessionKeys?: string[];
    completedChildSessionKeys?: string[];
    matchedCompletionCount?: number;
    lastCompletionAt?: number;
    nextCompletionId?: number;
    completions?: Array<{
      id: number;
      childSessionKey?: string;
      status: "ok" | "timeout" | "error" | "unknown";
      statusLabel: string;
      workerModel?: string;
      role?: string;
      deliverable?: string;
      acceptanceCriteria?: string[];
      responseFormat?: string;
      structuredResult?: unknown;
      malformedStructuredResult?: boolean;
      reviewed?: boolean;
      decision?: "accept" | "reject";
      nextAction?: "same_model_retry" | "switch_model_retry" | "final_failure";
      reason?: string;
      createdAt: number;
    }>;
    acceptedCompletionCount?: number;
    rejectedCompletionCount?: number;
    correctiveRetryCount?: number;
    childSpawns?: Array<{
      childSessionKey: string;
      model?: string;
      spawnedAt: number;
      isCorrective?: boolean;
      correctiveAttempt?: number;
      awaitingCompletion?: boolean;
    }>;
    pendingCorrectiveAction?: {
      requiredAction: "same_model_retry" | "switch_model_retry";
      rejectedChildSessionKey: string;
      rejectedModel?: string;
      rejectedCompletionId: number;
      createdAt: number;
    };
    finalFailureRequested?: boolean;
  };
};

export type ToolCallRecord = {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
};

export type SessionRef = {
  sessionId?: string;
  sessionKey?: string;
};

export const diagnosticSessionStates = new Map<string, SessionState>();

const SESSION_STATE_TTL_MS = 30 * 60 * 1000;
const SESSION_STATE_PRUNE_INTERVAL_MS = 60 * 1000;
const SESSION_STATE_MAX_ENTRIES = 2000;

let lastSessionPruneAt = 0;

export function pruneDiagnosticSessionStates(now = Date.now(), force = false): void {
  const shouldPruneForSize = diagnosticSessionStates.size > SESSION_STATE_MAX_ENTRIES;
  if (!force && !shouldPruneForSize && now - lastSessionPruneAt < SESSION_STATE_PRUNE_INTERVAL_MS) {
    return;
  }
  lastSessionPruneAt = now;

  for (const [key, state] of diagnosticSessionStates.entries()) {
    const ageMs = now - state.lastActivity;
    const isIdle = state.state === "idle";
    if (isIdle && state.queueDepth <= 0 && ageMs > SESSION_STATE_TTL_MS) {
      diagnosticSessionStates.delete(key);
    }
  }

  if (diagnosticSessionStates.size <= SESSION_STATE_MAX_ENTRIES) {
    return;
  }
  const excess = diagnosticSessionStates.size - SESSION_STATE_MAX_ENTRIES;
  const ordered = Array.from(diagnosticSessionStates.entries()).toSorted(
    (a, b) => a[1].lastActivity - b[1].lastActivity,
  );
  for (let i = 0; i < excess; i += 1) {
    const key = ordered[i]?.[0];
    if (!key) {
      break;
    }
    diagnosticSessionStates.delete(key);
  }
}

function resolveSessionKey({ sessionKey, sessionId }: SessionRef) {
  return sessionKey ?? sessionId ?? "unknown";
}

function findStateBySessionId(sessionId: string): SessionState | undefined {
  for (const state of diagnosticSessionStates.values()) {
    if (state.sessionId === sessionId) {
      return state;
    }
  }
  return undefined;
}

export function getDiagnosticSessionState(ref: SessionRef): SessionState {
  pruneDiagnosticSessionStates();
  const key = resolveSessionKey(ref);
  const existing =
    diagnosticSessionStates.get(key) ?? (ref.sessionId && findStateBySessionId(ref.sessionId));
  if (existing) {
    if (ref.sessionId) {
      existing.sessionId = ref.sessionId;
    }
    if (ref.sessionKey) {
      existing.sessionKey = ref.sessionKey;
    }
    return existing;
  }
  const created: SessionState = {
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    lastActivity: Date.now(),
    state: "idle",
    queueDepth: 0,
  };
  diagnosticSessionStates.set(key, created);
  pruneDiagnosticSessionStates(Date.now(), true);
  return created;
}

export function getDiagnosticSessionStateCountForTest(): number {
  return diagnosticSessionStates.size;
}

export function resetDiagnosticSessionStateForTest(): void {
  diagnosticSessionStates.clear();
  lastSessionPruneAt = 0;
}

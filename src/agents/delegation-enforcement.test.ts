import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import { createTaskCompletionFollowUpInputProvenance } from "../sessions/input-provenance.js";
import {
  clearDelegationWaitingForCompletions,
  getDelegationReviewState,
  getDelegationTracking,
  markDelegationWaitingForCompletions,
  recordDelegatedSubagentReview,
  recordDelegatedSubagentSpawn,
  recordDelegatedTaskCompletion,
  recordDelegatedTaskCompletionEvent,
  resolveTopLevelDelegationPolicy,
  resetDelegationTracking,
  validateDelegatedCorrectiveSpawn,
} from "./delegation-enforcement.js";

const mainRef = {
  sessionKey: "agent:main:main",
  sessionId: "session:main",
};

describe("delegation-enforcement", () => {
  beforeEach(() => {
    resetDiagnosticSessionStateForTest();
  });

  it("forces manager profile for top-level hard/all sessions", () => {
    const policy = resolveTopLevelDelegationPolicy({
      config: {
        agents: { defaults: { subagents: { delegation: { mode: "hard", scope: "all" } } } },
      } as OpenClawConfig,
      sessionKey: "agent:main:main",
    });

    expect(policy.topLevel).toBe(true);
    expect(policy.requiresDelegation).toBe(true);
    expect(policy.forcedToolProfile).toBe("manager");
  });

  it("defaults unset scope to action_only", () => {
    const config = {
      agents: { defaults: { subagents: { delegation: { mode: "hard" } } } },
    } as OpenClawConfig;

    const nonAction = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:main:main",
      prompt: "hello",
    });
    expect(nonAction.requiresDelegation).toBe(false);
    expect(nonAction.forcedToolProfile).toBeUndefined();

    const action = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:main:main",
      prompt: "Run tests and summarize failures",
    });
    expect(action.requiresDelegation).toBe(true);
    expect(action.forcedToolProfile).toBe("manager");
  });

  it("supports action_only scope", () => {
    const config = {
      agents: { defaults: { subagents: { delegation: { mode: "hard", scope: "action_only" } } } },
    } as OpenClawConfig;

    const nonAction = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:main:main",
      prompt: "hello",
    });
    expect(nonAction.requiresDelegation).toBe(false);
    expect(nonAction.forcedToolProfile).toBeUndefined();

    const action = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:main:main",
      prompt: "Run tests and summarize failures",
    });
    expect(action.requiresDelegation).toBe(true);
    expect(action.forcedToolProfile).toBe("manager");
  });

  it("does not require delegation for internal_system turns", () => {
    const policy = resolveTopLevelDelegationPolicy({
      config: {
        agents: { defaults: { subagents: { delegation: { mode: "hard", scope: "all" } } } },
      } as OpenClawConfig,
      sessionKey: "agent:main:main",
      prompt: "A new session was started via /new or /reset.",
      inputProvenance: { kind: "internal_system" },
    });

    expect(policy.requiresDelegation).toBe(false);
    expect(policy.forcedToolProfile).toBeUndefined();
    expect(policy.resumeExistingDelegation).toBe(false);
  });

  it("treats task completion follow-ups as delegated turns", () => {
    const policy = resolveTopLevelDelegationPolicy({
      config: {
        agents: {
          defaults: { subagents: { delegation: { mode: "hard", scope: "action_only" } } },
        },
      } as OpenClawConfig,
      sessionKey: "agent:main:main",
      prompt: "Worker finished.",
      inputProvenance: createTaskCompletionFollowUpInputProvenance({
        sourceSessionKey: "agent:main:subagent:child-1",
      }),
    });

    expect(policy.requiresDelegation).toBe(true);
    expect(policy.forcedToolProfile).toBe("manager");
    expect(policy.resumeExistingDelegation).toBe(true);
  });

  it("does not force delegation profile for subagent sessions", () => {
    const policy = resolveTopLevelDelegationPolicy({
      config: {
        agents: { defaults: { subagents: { delegation: { mode: "hard", scope: "all" } } } },
      } as OpenClawConfig,
      sessionKey: "agent:main:subagent:child",
    });

    expect(policy.topLevel).toBe(false);
    expect(policy.requiresDelegation).toBe(false);
    expect(policy.forcedToolProfile).toBeUndefined();
  });

  it("does not force delegation profile for cron and ACP sessions", () => {
    const config = {
      agents: { defaults: { subagents: { delegation: { mode: "hard", scope: "all" } } } },
    } as OpenClawConfig;

    const cronPolicy = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:main:cron:daily-report",
    });
    expect(cronPolicy.topLevel).toBe(false);
    expect(cronPolicy.requiresDelegation).toBe(false);
    expect(cronPolicy.forcedToolProfile).toBeUndefined();

    const acpPolicy = resolveTopLevelDelegationPolicy({
      config,
      sessionKey: "agent:codex:acp:task-1",
    });
    expect(acpPolicy.topLevel).toBe(false);
    expect(acpPolicy.requiresDelegation).toBe(false);
    expect(acpPolicy.forcedToolProfile).toBeUndefined();
  });

  it("counts completions that arrive before waiting phase starts", () => {
    resetDelegationTracking(mainRef);
    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-a");
    recordDelegatedTaskCompletion(mainRef, "agent:main:subagent:child-a");

    const beforeWaiting = getDelegationTracking(mainRef);
    expect(beforeWaiting.waitingForCompletions).toBe(false);
    expect(beforeWaiting.matchedCompletionCount).toBe(0);
    expect(beforeWaiting.completedChildSessionKeys).toEqual(["agent:main:subagent:child-a"]);

    markDelegationWaitingForCompletions(mainRef, ["agent:main:subagent:child-a"]);
    const afterWaiting = getDelegationTracking(mainRef);
    expect(afterWaiting.waitingForCompletions).toBe(true);
    expect(afterWaiting.matchedCompletionCount).toBe(1);
  });

  it("treats child error and timeout task_completion events as join matches", () => {
    resetDelegationTracking(mainRef);
    markDelegationWaitingForCompletions(mainRef, [
      "agent:main:subagent:error-child",
      "agent:main:subagent:timeout-child",
    ]);

    recordDelegatedTaskCompletionEvent(mainRef, {
      type: "task_completion",
      source: "subagent",
      childSessionKey: "agent:main:subagent:error-child",
      childSessionId: "child-error",
      announceType: "subagent task",
      taskLabel: "error-task",
      status: "error",
      statusLabel: "failed",
      result: "failed",
      replyInstruction: "continue",
    });

    recordDelegatedTaskCompletionEvent(mainRef, {
      type: "task_completion",
      source: "subagent",
      childSessionKey: "agent:main:subagent:timeout-child",
      childSessionId: "child-timeout",
      announceType: "subagent task",
      taskLabel: "timeout-task",
      status: "timeout",
      statusLabel: "timed out",
      result: "timed out",
      replyInstruction: "continue",
    });

    const tracking = getDelegationTracking(mainRef);
    expect(tracking.matchedCompletionCount).toBe(2);

    clearDelegationWaitingForCompletions(mainRef);
    expect(getDelegationTracking(mainRef).waitingForCompletions).toBe(false);
  });

  it("ignores non-subagent task completion events", () => {
    resetDelegationTracking(mainRef);
    markDelegationWaitingForCompletions(mainRef, ["agent:main:subagent:cron-child"]);

    recordDelegatedTaskCompletionEvent(mainRef, {
      type: "task_completion",
      source: "cron",
      childSessionKey: "agent:main:subagent:cron-child",
      childSessionId: "child-cron",
      announceType: "cron job",
      taskLabel: "cron",
      status: "ok",
      statusLabel: "ok",
      result: "done",
      replyInstruction: "continue",
    });

    expect(getDelegationTracking(mainRef).matchedCompletionCount).toBe(0);
  });
});

describe("delegation-enforcement review loop", () => {
  beforeEach(() => {
    resetDiagnosticSessionStateForTest();
  });

  function pushCompletion(params: {
    childSessionKey: string;
    status: "ok" | "error" | "timeout" | "unknown";
    statusLabel: string;
    workerModel?: string;
    responseFormat?: "text" | "structured";
    malformedStructuredResult?: boolean;
  }) {
    recordDelegatedTaskCompletionEvent(mainRef, {
      type: "task_completion",
      source: "subagent",
      childSessionKey: params.childSessionKey,
      childSessionId: params.childSessionKey + "-session",
      announceType: "subagent task",
      taskLabel: params.childSessionKey,
      status: params.status,
      statusLabel: params.statusLabel,
      result: "result-" + params.childSessionKey,
      replyInstruction: "continue",
      workerModel: params.workerModel,
      responseFormat: params.responseFormat,
      malformedStructuredResult: params.malformedStructuredResult,
    });
  }

  it("rejects accept decisions for objectively inadequate completions", () => {
    resetDelegationTracking(mainRef);
    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-error", {
      model: "openai/mock-1",
    });
    pushCompletion({
      childSessionKey: "agent:main:subagent:child-error",
      status: "error",
      statusLabel: "failed",
      workerModel: "openai/mock-1",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-error",
        decision: "accept",
        reason: "looks good",
      }),
    ).toEqual({
      ok: false,
      error:
        "Cannot accept an objectively inadequate completion (error/timeout/malformed structured output). Reject it with a retry or final_failure action.",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-error",
        decision: "reject",
        reason: "needs retry",
        nextAction: "same_model_retry",
      }),
    ).toEqual({ ok: true });
  });

  it("enforces corrective retry ordering and retry budget", () => {
    resetDelegationTracking(mainRef);

    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-1", {
      model: "openai/mock-1",
    });
    pushCompletion({
      childSessionKey: "agent:main:subagent:child-1",
      status: "ok",
      statusLabel: "ok",
      workerModel: "openai/mock-1",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-1",
        decision: "reject",
        reason: "not adequate",
        nextAction: "same_model_retry",
      }),
    ).toEqual({ ok: true });

    expect(
      validateDelegatedCorrectiveSpawn(mainRef, {
        model: "openai/mock-2",
      }),
    ).toEqual({
      ok: false,
      error:
        "Corrective retry requires the same model as the rejected worker result (nextAction=same_model_retry).",
    });

    expect(
      validateDelegatedCorrectiveSpawn(mainRef, {
        model: "openai/mock-1",
      }),
    ).toEqual({ ok: true });

    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-2", {
      model: "openai/mock-1",
    });
    pushCompletion({
      childSessionKey: "agent:main:subagent:child-2",
      status: "ok",
      statusLabel: "ok",
      workerModel: "openai/mock-1",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-2",
        decision: "reject",
        reason: "still not adequate",
        nextAction: "same_model_retry",
      }),
    ).toEqual({
      ok: false,
      error:
        "Second corrective retry must switch models. Use nextAction=switch_model_retry or nextAction=final_failure.",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-2",
        decision: "reject",
        reason: "switch model",
        nextAction: "switch_model_retry",
      }),
    ).toEqual({ ok: true });

    expect(
      validateDelegatedCorrectiveSpawn(mainRef, {
        model: "openai/mock-1",
      }),
    ).toEqual({
      ok: false,
      error:
        "Corrective retry requires a different model from the rejected worker result (nextAction=switch_model_retry).",
    });

    expect(
      validateDelegatedCorrectiveSpawn(mainRef, {
        model: "openai/mock-2",
      }),
    ).toEqual({ ok: true });

    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-3", {
      model: "openai/mock-2",
    });
    pushCompletion({
      childSessionKey: "agent:main:subagent:child-3",
      status: "error",
      statusLabel: "failed",
      workerModel: "openai/mock-2",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-3",
        decision: "reject",
        reason: "budget exhausted",
        nextAction: "switch_model_retry",
      }),
    ).toEqual({
      ok: false,
      error:
        "Corrective retry budget is exhausted (2). Use nextAction=final_failure and provide a failure-oriented final answer.",
    });

    expect(
      recordDelegatedSubagentReview(mainRef, {
        childSessionKey: "agent:main:subagent:child-3",
        decision: "reject",
        reason: "final failure",
        nextAction: "final_failure",
      }),
    ).toEqual({ ok: true });

    const reviewState = getDelegationReviewState(mainRef);
    expect(reviewState.correctiveRetryCount).toBe(2);
    expect(reviewState.finalFailureRequested).toBe(true);

    expect(
      validateDelegatedCorrectiveSpawn(mainRef, {
        model: "openai/mock-3",
      }),
    ).toEqual({
      ok: false,
      error:
        "final_failure has already been selected for this turn. Provide a failure-oriented final answer instead of spawning more workers.",
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import {
  clearDelegationWaitingForCompletions,
  getDelegationTracking,
  markDelegationWaitingForCompletions,
  recordDelegatedSubagentSpawn,
  recordDelegatedTaskCompletion,
  recordDelegatedTaskCompletionEvent,
  resolveTopLevelDelegationPolicy,
  resetDelegationTracking,
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

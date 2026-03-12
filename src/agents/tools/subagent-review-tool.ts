import { Type } from "@sinclair/typebox";
import {
  getDelegationReviewState,
  recordDelegatedSubagentReview,
} from "../delegation-enforcement.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolInputError } from "./common.js";

const SUBAGENT_REVIEW_DECISIONS = ["accept", "reject"] as const;
const SUBAGENT_REVIEW_NEXT_ACTIONS = [
  "same_model_retry",
  "switch_model_retry",
  "final_failure",
] as const;

const SubagentReviewToolSchema = Type.Object({
  childSessionKey: Type.String(),
  decision: stringEnum(SUBAGENT_REVIEW_DECISIONS),
  reason: Type.Optional(Type.String()),
  nextAction: Type.Optional(stringEnum(SUBAGENT_REVIEW_NEXT_ACTIONS)),
});

export function createSubagentReviewTool(opts?: {
  agentSessionKey?: string;
  agentSessionId?: string;
}): AnyAgentTool {
  return {
    label: "Subagent Review",
    name: "subagent_review",
    description:
      "Record an explicit manager review for a completed worker task (accept/reject with required next action on reject).",
    parameters: SubagentReviewToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const childSessionKey = readStringParam(params, "childSessionKey", { required: true });
      const decisionRaw = readStringParam(params, "decision", { required: true });
      const reason = readStringParam(params, "reason");
      const nextAction = readStringParam(params, "nextAction") as
        | "same_model_retry"
        | "switch_model_retry"
        | "final_failure"
        | undefined;

      const sessionKey = opts?.agentSessionKey?.trim();
      if (!sessionKey) {
        throw new ToolInputError("subagent_review requires an active manager session");
      }

      const decision = decisionRaw === "accept" || decisionRaw === "reject" ? decisionRaw : null;
      if (!decision) {
        throw new ToolInputError(`invalid decision: ${decisionRaw}`);
      }
      if (decision === "reject" && !nextAction) {
        throw new ToolInputError("nextAction is required when decision=reject");
      }

      const result = recordDelegatedSubagentReview(
        {
          sessionKey,
          sessionId: opts?.agentSessionId,
        },
        {
          childSessionKey,
          decision,
          reason,
          nextAction,
        },
      );

      if (!result.ok) {
        throw new ToolInputError(result.error);
      }

      const state = getDelegationReviewState({
        sessionKey,
        sessionId: opts?.agentSessionId,
      });

      return jsonResult({
        status: "ok",
        childSessionKey,
        decision,
        nextAction: decision === "reject" ? nextAction : undefined,
        state: {
          completionCount: state.completionCount,
          unreviewedCompletionCount: state.unreviewedCompletionCount,
          acceptedCompletionCount: state.acceptedCompletionCount,
          rejectedCompletionCount: state.rejectedCompletionCount,
          correctiveRetryCount: state.correctiveRetryCount,
          activeCorrectiveWorkerCount: state.activeCorrectiveWorkerCount,
          pendingCorrectiveAction: state.pendingCorrectiveAction,
          finalFailureRequested: state.finalFailureRequested,
        },
      });
    },
  };
}

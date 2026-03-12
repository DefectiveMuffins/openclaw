import type { ToolLoopDetectionConfig, ToolResultCacheConfig } from "../config/types.tools.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { isPlainObject } from "../utils.js";
import {
  isAcceptedSubagentSpawnResult,
  recordDelegatedSubagentSpawn,
} from "./delegation-enforcement.js";
import { normalizeToolName } from "./tool-policy.js";
import {
  getCachedToolResult,
  invalidateToolResultCache,
  isToolResultCacheInvalidationTool,
  setCachedToolResult,
} from "./tool-result-cache.js";
import type { ToolWorkingSetConfig } from "./tool-working-set.js";
import { addToolResultToWorkingSet, invalidateWorkingSet } from "./tool-working-set.js";
import type { AnyAgentTool } from "./tools/common.js";

export type HookContext = {
  agentId?: string;
  sessionKey?: string;
  loopDetection?: ToolLoopDetectionConfig;
  toolResultCache?: ToolResultCacheConfig;
  workingSet?: ToolWorkingSetConfig;
};

type HookOutcome = { blocked: true; reason: string } | { blocked: false; params: unknown };

const log = createSubsystemLogger("agents/tools");
const BEFORE_TOOL_CALL_WRAPPED = Symbol("beforeToolCallWrapped");
const adjustedParamsByToolCallId = new Map<string, unknown>();
const MAX_TRACKED_ADJUSTED_PARAMS = 1024;
const LOOP_WARNING_BUCKET_SIZE = 10;
const MAX_LOOP_WARNING_KEYS = 256;

function getSessionsSpawnRuntime(params: unknown): "subagent" | "acp" {
  if (!isPlainObject(params)) {
    return "subagent";
  }
  return params.runtime === "acp" ? "acp" : "subagent";
}

function getSessionsSpawnModel(params: unknown): string | undefined {
  if (!isPlainObject(params)) {
    return undefined;
  }
  const model = params.model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function maybeRecordDelegatedSpawn(args: {
  ctx?: HookContext;
  toolName: string;
  toolParams: unknown;
  result: unknown;
}): void {
  if (!args.ctx?.sessionKey) {
    return;
  }
  if (args.toolName !== "sessions_spawn") {
    return;
  }
  if (getSessionsSpawnRuntime(args.toolParams) !== "subagent") {
    return;
  }
  const resultDetails =
    isPlainObject(args.result) && "details" in args.result
      ? (args.result as { details?: unknown }).details
      : args.result;
  if (!isAcceptedSubagentSpawnResult(resultDetails)) {
    return;
  }
  recordDelegatedSubagentSpawn(
    {
      sessionKey: args.ctx.sessionKey,
      sessionId: args.ctx.agentId,
    },
    resultDetails.childSessionKey,
    {
      model:
        (typeof resultDetails.model === "string" && resultDetails.model.trim()
          ? resultDetails.model.trim()
          : undefined) ?? getSessionsSpawnModel(args.toolParams),
    },
  );
}
function shouldEmitLoopWarning(state: SessionState, warningKey: string, count: number): boolean {
  if (!state.toolLoopWarningBuckets) {
    state.toolLoopWarningBuckets = new Map();
  }
  const bucket = Math.floor(count / LOOP_WARNING_BUCKET_SIZE);
  const lastBucket = state.toolLoopWarningBuckets.get(warningKey) ?? 0;
  if (bucket <= lastBucket) {
    return false;
  }
  state.toolLoopWarningBuckets.set(warningKey, bucket);
  if (state.toolLoopWarningBuckets.size > MAX_LOOP_WARNING_KEYS) {
    const oldest = state.toolLoopWarningBuckets.keys().next().value;
    if (oldest) {
      state.toolLoopWarningBuckets.delete(oldest);
    }
  }
  return true;
}

async function recordLoopOutcome(args: {
  ctx?: HookContext;
  toolName: string;
  toolParams: unknown;
  toolCallId?: string;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  if (!args.ctx?.sessionKey) {
    return;
  }
  try {
    const { getDiagnosticSessionState } = await import("../logging/diagnostic-session-state.js");
    const { recordToolCallOutcome } = await import("./tool-loop-detection.js");
    const sessionState = getDiagnosticSessionState({
      sessionKey: args.ctx.sessionKey,
      sessionId: args.ctx?.agentId,
    });
    recordToolCallOutcome(sessionState, {
      toolName: args.toolName,
      toolParams: args.toolParams,
      toolCallId: args.toolCallId,
      result: args.result,
      error: args.error,
      config: args.ctx.loopDetection,
    });
  } catch (err) {
    log.warn(`tool loop outcome tracking failed: tool=${args.toolName} error=${String(err)}`);
  }
}

export async function runBeforeToolCallHook(args: {
  toolName: string;
  params: unknown;
  toolCallId?: string;
  ctx?: HookContext;
}): Promise<HookOutcome> {
  const toolName = normalizeToolName(args.toolName || "tool");
  const params = args.params;

  if (args.ctx?.sessionKey) {
    const { getDiagnosticSessionState } = await import("../logging/diagnostic-session-state.js");
    const { logToolLoopAction } = await import("../logging/diagnostic.js");
    const { detectToolCallLoop, recordToolCall } = await import("./tool-loop-detection.js");

    const sessionState = getDiagnosticSessionState({
      sessionKey: args.ctx.sessionKey,
      sessionId: args.ctx?.agentId,
    });

    const loopResult = detectToolCallLoop(sessionState, toolName, params, args.ctx.loopDetection);

    if (loopResult.stuck) {
      if (loopResult.level === "critical") {
        log.error(`Blocking ${toolName} due to critical loop: ${loopResult.message}`);
        logToolLoopAction({
          sessionKey: args.ctx.sessionKey,
          sessionId: args.ctx?.agentId,
          toolName,
          level: "critical",
          action: "block",
          detector: loopResult.detector,
          count: loopResult.count,
          message: loopResult.message,
          pairedToolName: loopResult.pairedToolName,
        });
        return {
          blocked: true,
          reason: loopResult.message,
        };
      } else {
        const warningKey = loopResult.warningKey ?? `${loopResult.detector}:${toolName}`;
        if (shouldEmitLoopWarning(sessionState, warningKey, loopResult.count)) {
          log.warn(`Loop warning for ${toolName}: ${loopResult.message}`);
          logToolLoopAction({
            sessionKey: args.ctx.sessionKey,
            sessionId: args.ctx?.agentId,
            toolName,
            level: "warning",
            action: "warn",
            detector: loopResult.detector,
            count: loopResult.count,
            message: loopResult.message,
            pairedToolName: loopResult.pairedToolName,
          });
        }
      }
    }

    recordToolCall(sessionState, toolName, params, args.toolCallId, args.ctx.loopDetection);
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_tool_call")) {
    return { blocked: false, params: args.params };
  }

  try {
    const normalizedParams = isPlainObject(params) ? params : {};
    const hookResult = await hookRunner.runBeforeToolCall(
      {
        toolName,
        params: normalizedParams,
      },
      {
        toolName,
        agentId: args.ctx?.agentId,
        sessionKey: args.ctx?.sessionKey,
      },
    );

    if (hookResult?.block) {
      return {
        blocked: true,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      };
    }

    if (hookResult?.params && isPlainObject(hookResult.params)) {
      if (isPlainObject(params)) {
        return { blocked: false, params: { ...params, ...hookResult.params } };
      }
      return { blocked: false, params: hookResult.params };
    }
  } catch (err) {
    const toolCallId = args.toolCallId ? ` toolCallId=${args.toolCallId}` : "";
    log.warn(`before_tool_call hook failed: tool=${toolName}${toolCallId} error=${String(err)}`);
  }

  return { blocked: false, params };
}

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (
      toolCallId,
      params,
      signal,
      onUpdate,
    ): Promise<Awaited<ReturnType<typeof execute>>> => {
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx,
      });
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }
      if (toolCallId) {
        adjustedParamsByToolCallId.set(toolCallId, outcome.params);
        if (adjustedParamsByToolCallId.size > MAX_TRACKED_ADJUSTED_PARAMS) {
          const oldest = adjustedParamsByToolCallId.keys().next().value;
          if (oldest) {
            adjustedParamsByToolCallId.delete(oldest);
          }
        }
      }

      const normalizedToolName = normalizeToolName(toolName || "tool");

      if (ctx?.sessionKey && isToolResultCacheInvalidationTool(normalizedToolName)) {
        invalidateToolResultCache(ctx.sessionKey);
        invalidateWorkingSet(ctx.sessionKey);
      }

      const cachedResult = getCachedToolResult({
        sessionKey: ctx?.sessionKey,
        toolName: normalizedToolName,
        toolParams: outcome.params,
        config: ctx?.toolResultCache,
      });
      if (cachedResult.hit) {
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          result: cachedResult.result,
        });
        return cachedResult.result as Awaited<ReturnType<typeof execute>>;
      }

      try {
        const result = await execute(toolCallId, outcome.params, signal, onUpdate);
        maybeRecordDelegatedSpawn({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          result,
        });
        setCachedToolResult({
          sessionKey: ctx?.sessionKey,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          result,
          config: ctx?.toolResultCache,
        });
        addToolResultToWorkingSet({
          sessionKey: ctx?.sessionKey,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          result,
          config: ctx?.workingSet,
        });
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          result,
        });
        return result;
      } catch (err) {
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          error: err,
        });
        throw err;
      }
    },
  };
  Object.defineProperty(wrappedTool, BEFORE_TOOL_CALL_WRAPPED, {
    value: true,
    enumerable: true,
  });
  return wrappedTool;
}

export function isToolWrappedWithBeforeToolCallHook(tool: AnyAgentTool): boolean {
  const taggedTool = tool as unknown as Record<symbol, unknown>;
  return taggedTool[BEFORE_TOOL_CALL_WRAPPED] === true;
}

export function consumeAdjustedParamsForToolCall(toolCallId: string): unknown {
  const params = adjustedParamsByToolCallId.get(toolCallId);
  adjustedParamsByToolCallId.delete(toolCallId);
  return params;
}

export const __testing = {
  BEFORE_TOOL_CALL_WRAPPED,
  adjustedParamsByToolCallId,
  runBeforeToolCallHook,
  isPlainObject,
};

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BARE_SESSION_RESET_PROMPT } from "../auto-reply/reply/session-reset-prompt.js";
import type { OpenClawConfig } from "../config/config.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import { createTaskCompletionFollowUpInputProvenance } from "../sessions/input-provenance.js";
import {
  recordDelegatedSubagentReview,
  recordDelegatedSubagentSpawn,
  recordDelegatedTaskCompletionEvent,
} from "./delegation-enforcement.js";
import type { EmbeddedRunAttemptResult } from "./pi-embedded-runner/run/types.js";

const runEmbeddedAttemptMock = vi.fn<(params: unknown) => Promise<EmbeddedRunAttemptResult>>();

vi.mock("./pi-embedded-runner/run/attempt.js", () => ({
  runEmbeddedAttempt: (params: unknown) => runEmbeddedAttemptMock(params),
}));

vi.mock("./pi-embedded-runner/compact.js", () => ({
  compactEmbeddedPiSessionDirect: vi.fn(async () => {
    throw new Error("compact should not run in hard delegation tests");
  }),
}));

vi.mock("./models-config.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./models-config.js")>();
  return {
    ...mod,
    ensureOpenClawModelsJson: vi.fn(async () => ({ wrote: false })),
  };
});

let runEmbeddedPiAgent: typeof import("./pi-embedded-runner/run.js").runEmbeddedPiAgent;

beforeAll(async () => {
  ({ runEmbeddedPiAgent } = await import("./pi-embedded-runner/run.js"));
});

beforeEach(() => {
  runEmbeddedAttemptMock.mockReset();
  resetDiagnosticSessionStateForTest();
});

const baseUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const buildAssistant = (overrides: Partial<AssistantMessage>): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: "openai-responses",
  provider: "openai",
  model: "mock-1",
  usage: baseUsage,
  stopReason: "stop",
  timestamp: Date.now(),
  ...overrides,
});

const makeAttempt = (overrides: Partial<EmbeddedRunAttemptResult>): EmbeddedRunAttemptResult => ({
  aborted: false,
  timedOut: false,
  timedOutDuringCompaction: false,
  promptError: null,
  sessionIdUsed: "session:test-hard",
  systemPromptReport: undefined,
  messagesSnapshot: [],
  assistantTexts: [],
  toolMetas: [],
  lastAssistant: undefined,
  didSendViaMessagingTool: false,
  messagingToolSentTexts: [],
  messagingToolSentMediaUrls: [],
  messagingToolSentTargets: [],
  cloudCodeAssistFormatError: false,
  ...overrides,
});

const makeConfig = (
  mode: "off" | "soft" | "hard" = "hard",
  scope: "all" | "action_only" = "all",
): OpenClawConfig =>
  ({
    agents: {
      defaults: {
        subagents: {
          delegation: {
            mode,
            scope,
          },
        },
      },
    },
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "test-key",
          baseUrl: "https://example.com",
          models: [
            {
              id: "mock-1",
              name: "Mock 1",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16_000,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
  }) satisfies OpenClawConfig;

async function withAgentWorkspace<T>(
  run: (ctx: { agentDir: string; workspaceDir: string; sessionFile: string }) => Promise<T>,
) {
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-"));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-"));
  const sessionFile = path.join(workspaceDir, "session.jsonl");
  try {
    return await run({ agentDir, workspaceDir, sessionFile });
  } finally {
    await fs.rm(agentDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

function payloadText(result: Awaited<ReturnType<typeof runEmbeddedPiAgent>>): string {
  return (result.payloads ?? [])
    .map((payload) => payload.text ?? "")
    .join("\n")
    .trim();
}

function appendPromptAndReply(params: {
  sessionFile: string;
  prompt: string;
  reply: string;
  model?: string;
}) {
  const sessionManager = SessionManager.open(params.sessionFile);
  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: params.prompt }],
    timestamp: Date.now(),
  });
  sessionManager.appendMessage(
    buildAssistant({
      model: params.model ?? "mock-1",
      content: [{ type: "text", text: params.reply }],
    }),
  );
}

function getBranchMessageTexts(sessionFile: string, role: "user" | "assistant"): string[] {
  return SessionManager.open(sessionFile)
    .getBranch()
    .flatMap((entry) => {
      if (entry.type !== "message" || entry.message.role !== role) {
        return [];
      }
      const content = entry.message.content;
      if (!Array.isArray(content)) {
        return [];
      }
      return content.flatMap((block) =>
        block && typeof block === "object" && "text" in block && typeof block.text === "string"
          ? [block.text]
          : [],
      );
    });
}

describe("runEmbeddedPiAgent hard delegation", () => {
  it("does not deliver a direct answer in planning phase when no spawn occurs", async () => {
    runEmbeddedAttemptMock
      .mockResolvedValueOnce(
        makeAttempt({
          assistantTexts: ["direct answer that should be blocked"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "direct answer that should be blocked" }],
          }),
        }),
      )
      .mockResolvedValueOnce(
        makeAttempt({
          timedOut: true,
          assistantTexts: [],
          lastAssistant: undefined,
        }),
      );

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-hard",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("hard"),
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:hard-no-spawn",
      });

      const text = payloadText(result);
      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
      expect(text).not.toContain("direct answer that should be blocked");
      expect(text).toContain("Request timed out before a response was generated");
    });
  });

  it("blocks after spawn until join timeout/failure handling when no completion arrives", async () => {
    const childSessionKey = "agent:main:subagent:child-timeout";

    runEmbeddedAttemptMock.mockImplementationOnce(async () => {
      recordDelegatedSubagentSpawn(
        {
          sessionKey: "agent:main:main",
          sessionId: "session:test-hard",
        },
        childSessionKey,
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
      return makeAttempt({
        assistantTexts: ["spawned but no completion yet"],
        lastAssistant: buildAssistant({
          content: [{ type: "text", text: "spawned but no completion yet" }],
        }),
      });
    });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-hard",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("hard"),
        prompt: "delegate this",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 1,
        runId: "run:hard-join-timeout",
      });

      const text = payloadText(result);
      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
      expect(text).toContain("Request timed out while waiting for delegated worker completion");
      expect(text).not.toContain("spawned but no completion yet");
    });
  });

  it.each([
    {
      status: "ok" as const,
      statusLabel: "completed successfully",
      reviewDecision: "accept" as const,
      nextAction: undefined,
    },
    {
      status: "error" as const,
      statusLabel: "failed",
      reviewDecision: "reject" as const,
      nextAction: "final_failure" as const,
    },
    {
      status: "timeout" as const,
      statusLabel: "timed out",
      reviewDecision: "reject" as const,
      nextAction: "final_failure" as const,
    },
  ])(
    "unblocks synthesis when child completion status is $status",
    async ({ status, statusLabel, reviewDecision, nextAction }) => {
      const childSessionKey = `agent:main:subagent:child-${status}`;
      let attemptIndex = 0;

      setTimeout(() => {
        recordDelegatedTaskCompletionEvent(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-hard",
          },
          {
            type: "task_completion",
            source: "subagent",
            childSessionKey,
            childSessionId: `session-${status}`,
            announceType: "subagent task",
            taskLabel: `task-${status}`,
            status,
            statusLabel,
            result: `result-${status}`,
            replyInstruction: "continue",
          },
        );
      }, 15);
      runEmbeddedAttemptMock.mockImplementation(async () => {
        attemptIndex += 1;

        if (attemptIndex === 1) {
          recordDelegatedSubagentSpawn(
            {
              sessionKey: "agent:main:main",
              sessionId: "session:test-hard",
            },
            childSessionKey,
          );
          return makeAttempt({
            assistantTexts: ["spawn accepted"],
            lastAssistant: buildAssistant({
              content: [{ type: "text", text: "spawn accepted" }],
            }),
          });
        }

        if (attemptIndex === 2) {
          const reviewResult = recordDelegatedSubagentReview(
            {
              sessionKey: "agent:main:main",
              sessionId: "session:test-hard",
            },
            {
              childSessionKey,
              decision: reviewDecision,
              reason: `review-${status}`,
              nextAction,
            },
          );
          if (!reviewResult.ok) {
            throw new Error(reviewResult.error);
          }

          return makeAttempt({
            assistantTexts: [`reviewed-${status}`],
            lastAssistant: buildAssistant({
              content: [{ type: "text", text: `reviewed-${status}` }],
            }),
          });
        }

        return makeAttempt({
          assistantTexts: [`final-${status}`],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: `final-${status}` }],
          }),
        });
      });

      await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
        const result = await runEmbeddedPiAgent({
          sessionId: "session:test-hard",
          sessionKey: "agent:main:main",
          sessionFile,
          workspaceDir,
          agentDir,
          config: makeConfig("hard"),
          prompt: "delegate and synthesize",
          provider: "openai",
          model: "mock-1",
          timeoutMs: 2_000,
          runId: `run:hard-${status}`,
        });

        expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(3);
        expect(payloadText(result)).toContain(`final-${status}`);
      });
    },
  );

  it("buffers rejected-attempt reasoning and agent events until synthesis succeeds", async () => {
    const childSessionKey = "agent:main:subagent:child-buffered";
    const seenReasoning: string[] = [];
    const seenEvents: string[] = [];
    let reasoningEndCount = 0;
    let attemptIndex = 0;

    runEmbeddedAttemptMock.mockImplementation(async (params) => {
      const typedParams = params as {
        onReasoningStream?: (payload: { text?: string }) => Promise<void>;
        onReasoningEnd?: () => Promise<void>;
        onAgentEvent?: (event: { stream: string; data: Record<string, unknown> }) => void;
      };
      attemptIndex += 1;

      if (attemptIndex === 1) {
        await typedParams.onReasoningStream?.({ text: "planning reasoning" });
        await typedParams.onReasoningEnd?.();
        typedParams.onAgentEvent?.({ stream: "lifecycle", data: { phase: "planning" } });
        recordDelegatedSubagentSpawn(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-hard",
          },
          childSessionKey,
        );
        return makeAttempt({
          assistantTexts: ["spawn accepted"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "spawn accepted" }],
          }),
        });
      }

      if (attemptIndex === 2) {
        await typedParams.onReasoningStream?.({ text: "review reasoning" });
        await typedParams.onReasoningEnd?.();
        typedParams.onAgentEvent?.({ stream: "lifecycle", data: { phase: "review" } });
        const reviewResult = recordDelegatedSubagentReview(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-hard",
          },
          {
            childSessionKey,
            decision: "accept",
            reason: "looks good",
          },
        );
        if (!reviewResult.ok) {
          throw new Error(reviewResult.error);
        }
        return makeAttempt({
          assistantTexts: ["review accepted"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "review accepted" }],
          }),
        });
      }

      await typedParams.onReasoningStream?.({ text: "synthesis reasoning" });
      await typedParams.onReasoningEnd?.();
      typedParams.onAgentEvent?.({ stream: "lifecycle", data: { phase: "synthesis" } });
      return makeAttempt({
        assistantTexts: ["final answer"],
        lastAssistant: buildAssistant({
          content: [{ type: "text", text: "final answer" }],
        }),
      });
    });

    setTimeout(() => {
      recordDelegatedTaskCompletionEvent(
        {
          sessionKey: "agent:main:main",
          sessionId: "session:test-hard",
        },
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey,
          childSessionId: "session-buffered-child",
          announceType: "subagent task",
          taskLabel: "buffered-task",
          status: "ok",
          statusLabel: "completed successfully",
          result: "buffered-result",
          replyInstruction: "continue",
        },
      );
    }, 15);

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-hard",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("hard"),
        prompt: "delegate and synthesize",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:hard-buffered-visibility",
        onReasoningStream: async (payload) => {
          seenReasoning.push(payload.text ?? "");
        },
        onReasoningEnd: async () => {
          reasoningEndCount += 1;
        },
        onAgentEvent: (event) => {
          seenEvents.push(`${event.stream}:${String(event.data.phase ?? "")}`);
        },
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(3);
      expect(payloadText(result)).toContain("final answer");
      expect(seenReasoning).toEqual(["synthesis reasoning"]);
      expect(reasoningEndCount).toBe(1);
      expect(seenEvents).toEqual(["lifecycle:synthesis"]);
    });
  });

  it("returns an explicit error when synthesis finishes without a visible reply", async () => {
    const childSessionKey = "agent:main:subagent:child-empty-synthesis";
    let attemptIndex = 0;

    setTimeout(() => {
      recordDelegatedTaskCompletionEvent(
        {
          sessionKey: "agent:main:main",
          sessionId: "session:test-hard",
        },
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey,
          childSessionId: "session-empty-child",
          announceType: "subagent task",
          taskLabel: "empty-synthesis-task",
          status: "ok",
          statusLabel: "completed successfully",
          result: "empty-synthesis-result",
          replyInstruction: "continue",
        },
      );
    }, 15);

    runEmbeddedAttemptMock.mockImplementation(async () => {
      attemptIndex += 1;

      if (attemptIndex === 1) {
        recordDelegatedSubagentSpawn(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-hard",
          },
          childSessionKey,
        );
        return makeAttempt({
          assistantTexts: ["spawn accepted"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "spawn accepted" }],
          }),
        });
      }

      if (attemptIndex === 2) {
        const reviewResult = recordDelegatedSubagentReview(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-hard",
          },
          {
            childSessionKey,
            decision: "accept",
            reason: "approved",
          },
        );
        if (!reviewResult.ok) {
          throw new Error(reviewResult.error);
        }
        return makeAttempt({
          assistantTexts: ["reviewed"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "reviewed" }],
          }),
        });
      }

      return makeAttempt({
        assistantTexts: [],
        lastAssistant: buildAssistant({
          content: [],
        }),
      });
    });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-hard",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("hard"),
        prompt: "delegate and synthesize",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:hard-empty-synthesis",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(3);
      expect(payloadText(result)).toContain(
        "Delegated worker review completed, but the manager did not produce a final response.",
      );
    });
  });

  it("preserves soft mode retry behavior", async () => {
    const seenAssistantStarts: string[] = [];
    const seenPartials: string[] = [];
    const seenToolResults: string[] = [];
    const seenBlocks: string[] = [];
    const seenEvents: string[] = [];
    let blockFlushCount = 0;

    runEmbeddedAttemptMock
      .mockImplementationOnce(async (params) => {
        const typedParams = params as {
          sessionFile: string;
          prompt: string;
          onAssistantMessageStart?: () => Promise<void>;
          onPartialReply?: (payload: { text?: string }) => Promise<void>;
          onToolResult?: (payload: { text?: string }) => Promise<void>;
          onBlockReply?: (payload: { text?: string }) => Promise<void>;
          onBlockReplyFlush?: () => Promise<void>;
          onAgentEvent?: (event: { stream: string; data: Record<string, unknown> }) => void;
        };
        appendPromptAndReply({
          sessionFile: typedParams.sessionFile,
          prompt: typedParams.prompt,
          reply: "direct answer before delegation",
        });
        await typedParams.onAssistantMessageStart?.();
        await typedParams.onPartialReply?.({ text: "discarded partial" });
        await typedParams.onToolResult?.({ text: "discarded tool result" });
        await typedParams.onBlockReply?.({ text: "discarded block reply" });
        await typedParams.onBlockReplyFlush?.();
        typedParams.onAgentEvent?.({ stream: "assistant", data: { text: "discarded event" } });
        typedParams.onAgentEvent?.({ stream: "tool", data: { name: "discarded tool" } });
        typedParams.onAgentEvent?.({ stream: "block", data: { text: "discarded block" } });
        return makeAttempt({
          assistantTexts: ["direct answer before delegation"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "direct answer before delegation" }],
          }),
        });
      })
      .mockImplementationOnce(async (params) => {
        const typedParams = params as {
          sessionFile: string;
          prompt: string;
          onAssistantMessageStart?: () => Promise<void>;
          onPartialReply?: (payload: { text?: string }) => Promise<void>;
          onToolResult?: (payload: { text?: string }) => Promise<void>;
          onBlockReply?: (payload: { text?: string }) => Promise<void>;
          onBlockReplyFlush?: () => Promise<void>;
          onAgentEvent?: (event: { stream: string; data: Record<string, unknown> }) => void;
        };
        recordDelegatedSubagentSpawn(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-soft",
          },
          "agent:main:subagent:child-soft",
        );
        appendPromptAndReply({
          sessionFile: typedParams.sessionFile,
          prompt: typedParams.prompt,
          reply: "soft-mode final",
        });
        await typedParams.onAssistantMessageStart?.();
        await typedParams.onPartialReply?.({ text: "kept partial" });
        await typedParams.onToolResult?.({ text: "kept tool result" });
        await typedParams.onBlockReply?.({ text: "kept block reply" });
        await typedParams.onBlockReplyFlush?.();
        typedParams.onAgentEvent?.({ stream: "assistant", data: { text: "kept event" } });
        typedParams.onAgentEvent?.({ stream: "tool", data: { name: "kept tool" } });
        typedParams.onAgentEvent?.({ stream: "block", data: { text: "kept block" } });
        return makeAttempt({
          assistantTexts: ["soft-mode final"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "soft-mode final" }],
          }),
        });
      });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-soft",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("soft"),
        prompt: "Run tests and summarize failures",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:soft-mode",
        onAssistantMessageStart: async () => {
          seenAssistantStarts.push("start");
        },
        onPartialReply: async (payload) => {
          seenPartials.push(payload.text ?? "");
        },
        onToolResult: async (payload) => {
          seenToolResults.push(payload.text ?? "");
        },
        onBlockReply: async (payload) => {
          seenBlocks.push(payload.text ?? "");
        },
        onBlockReplyFlush: async () => {
          blockFlushCount += 1;
        },
        onAgentEvent: (event) => {
          seenEvents.push(`${event.stream}:${String(event.data.text ?? event.data.name ?? "")}`);
        },
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
      expect(payloadText(result)).toContain("soft-mode final");
      expect(getBranchMessageTexts(sessionFile, "user")).toEqual([
        "Run tests and summarize failures",
      ]);
      expect(getBranchMessageTexts(sessionFile, "assistant")).toEqual(["soft-mode final"]);
      expect(seenAssistantStarts).toEqual(["start"]);
      expect(seenPartials).toEqual(["kept partial"]);
      expect(seenToolResults).toEqual(["kept tool result"]);
      expect(seenBlocks).toEqual(["kept block reply"]);
      expect(blockFlushCount).toBe(1);
      expect(seenEvents).toEqual(["assistant:kept event", "tool:kept tool", "block:kept block"]);
    });
  });

  it("resumes soft delegation follow-up turns without requiring a fresh spawn", async () => {
    const mainRef = {
      sessionKey: "agent:main:main",
      sessionId: "session:test-soft-follow-up",
    };
    recordDelegatedSubagentSpawn(mainRef, "agent:main:subagent:child-soft");

    runEmbeddedAttemptMock.mockImplementationOnce(async (params) => {
      const typedParams = params as { sessionFile: string; prompt: string };
      appendPromptAndReply({
        sessionFile: typedParams.sessionFile,
        prompt: typedParams.prompt,
        reply: "soft follow-up synthesis",
      });
      return makeAttempt({
        sessionIdUsed: mainRef.sessionId,
        assistantTexts: ["soft follow-up synthesis"],
        lastAssistant: buildAssistant({
          content: [{ type: "text", text: "soft follow-up synthesis" }],
        }),
      });
    });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: mainRef.sessionId,
        sessionKey: mainRef.sessionKey,
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("soft", "all"),
        prompt: "Worker finished.",
        inputProvenance: createTaskCompletionFollowUpInputProvenance({
          sourceSessionKey: "agent:main:subagent:child-soft",
        }),
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:soft-follow-up",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
      expect(payloadText(result)).toContain("soft follow-up synthesis");
    });
  });

  it("resumes hard delegation review and synthesis for task completion follow-ups", async () => {
    const mainRef = {
      sessionKey: "agent:main:main",
      sessionId: "session:test-hard-follow-up",
    };
    const childSessionKey = "agent:main:subagent:child-hard";
    recordDelegatedSubagentSpawn(mainRef, childSessionKey, {
      model: "openai/mock-1",
    });
    recordDelegatedTaskCompletionEvent(mainRef, {
      type: "task_completion",
      source: "subagent",
      childSessionKey,
      childSessionId: "child-hard-session",
      announceType: "subagent task",
      taskLabel: "child-hard",
      status: "ok",
      statusLabel: "completed successfully",
      result: "worker result",
      replyInstruction: "continue",
      workerModel: "openai/mock-1",
    });

    runEmbeddedAttemptMock
      .mockImplementationOnce(async (params) => {
        const typedParams = params as { sessionFile: string; prompt: string };
        const review = recordDelegatedSubagentReview(mainRef, {
          childSessionKey,
          decision: "accept",
          reason: "approved",
        });
        if (!review.ok) {
          throw new Error(review.error);
        }
        appendPromptAndReply({
          sessionFile: typedParams.sessionFile,
          prompt: typedParams.prompt,
          reply: "reviewed",
        });
        return makeAttempt({
          sessionIdUsed: mainRef.sessionId,
          assistantTexts: ["reviewed"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "reviewed" }],
          }),
        });
      })
      .mockImplementationOnce(async (params) => {
        const typedParams = params as { sessionFile: string; prompt: string };
        appendPromptAndReply({
          sessionFile: typedParams.sessionFile,
          prompt: typedParams.prompt,
          reply: "hard follow-up synthesis",
        });
        return makeAttempt({
          sessionIdUsed: mainRef.sessionId,
          assistantTexts: ["hard follow-up synthesis"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "hard follow-up synthesis" }],
          }),
        });
      });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: mainRef.sessionId,
        sessionKey: mainRef.sessionKey,
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("hard", "action_only"),
        prompt: "Worker finished.",
        inputProvenance: createTaskCompletionFollowUpInputProvenance({
          sourceSessionKey: childSessionKey,
        }),
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:hard-follow-up",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
      expect(payloadText(result)).toContain("hard follow-up synthesis");
    });
  });

  it("uses delegationPrompt instead of the expanded prompt for action_only checks", async () => {
    runEmbeddedAttemptMock.mockImplementationOnce(async (params) => {
      const typedParams = params as { sessionFile: string; prompt: string };
      appendPromptAndReply({
        sessionFile: typedParams.sessionFile,
        prompt: typedParams.prompt,
        reply: "plain direct answer",
      });
      return makeAttempt({
        assistantTexts: ["plain direct answer"],
        lastAssistant: buildAssistant({
          content: [{ type: "text", text: "plain direct answer" }],
        }),
      });
    });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-delegation-prompt",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("soft", "action_only"),
        prompt:
          "[Thread history - for context]\nRun tests and summarize failures\n\nSender (untrusted metadata): hi",
        delegationPrompt: "hi",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:delegation-prompt",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
      expect(payloadText(result)).toContain("plain direct answer");
      expect(getBranchMessageTexts(sessionFile, "assistant")).toEqual(["plain direct answer"]);
    });
  });

  it("does not retry internal startup/reset prompts", async () => {
    runEmbeddedAttemptMock.mockImplementationOnce(async (params) => {
      const typedParams = params as { sessionFile: string; prompt: string };
      appendPromptAndReply({
        sessionFile: typedParams.sessionFile,
        prompt: typedParams.prompt,
        reply: "Hey! Fresh session - what do you want to do today?",
      });
      return makeAttempt({
        assistantTexts: ["Hey! Fresh session - what do you want to do today?"],
        lastAssistant: buildAssistant({
          content: [{ type: "text", text: "Hey! Fresh session - what do you want to do today?" }],
        }),
      });
    });

    await withAgentWorkspace(async ({ agentDir, workspaceDir, sessionFile }) => {
      const result = await runEmbeddedPiAgent({
        sessionId: "session:test-reset",
        sessionKey: "agent:main:main",
        sessionFile,
        workspaceDir,
        agentDir,
        config: makeConfig("soft"),
        prompt: BARE_SESSION_RESET_PROMPT,
        inputProvenance: { kind: "internal_system" },
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:startup-reset",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
      expect(payloadText(result)).toContain("Fresh session");
      expect(getBranchMessageTexts(sessionFile, "user")).toEqual([BARE_SESSION_RESET_PROMPT]);
      expect(getBranchMessageTexts(sessionFile, "assistant")).toEqual([
        "Hey! Fresh session - what do you want to do today?",
      ]);
    });
  });
});

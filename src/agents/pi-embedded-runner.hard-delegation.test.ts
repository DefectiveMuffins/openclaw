import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetDiagnosticSessionStateForTest } from "../logging/diagnostic-session-state.js";
import {
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

const makeConfig = (mode: "off" | "soft" | "hard" = "hard"): OpenClawConfig =>
  ({
    agents: {
      defaults: {
        subagents: {
          delegation: {
            mode,
            scope: "all",
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
    { status: "ok" as const, statusLabel: "completed successfully" },
    { status: "error" as const, statusLabel: "failed" },
    { status: "timeout" as const, statusLabel: "timed out" },
  ])(
    "unblocks synthesis when child completion status is $status",
    async ({ status, statusLabel }) => {
      const childSessionKey = `agent:main:subagent:child-${status}`;
      let attemptIndex = 0;
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
          return makeAttempt({
            assistantTexts: ["completion arrived"],
            lastAssistant: buildAssistant({
              content: [{ type: "text", text: "completion arrived" }],
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

  it("preserves soft mode retry behavior", async () => {
    runEmbeddedAttemptMock
      .mockResolvedValueOnce(
        makeAttempt({
          assistantTexts: ["direct answer before delegation"],
          lastAssistant: buildAssistant({
            content: [{ type: "text", text: "direct answer before delegation" }],
          }),
        }),
      )
      .mockImplementationOnce(async () => {
        recordDelegatedSubagentSpawn(
          {
            sessionKey: "agent:main:main",
            sessionId: "session:test-soft",
          },
          "agent:main:subagent:child-soft",
        );
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
        prompt: "hello",
        provider: "openai",
        model: "mock-1",
        timeoutMs: 2_000,
        runId: "run:soft-mode",
      });

      expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
      expect(payloadText(result)).toContain("soft-mode final");
    });
  });
});

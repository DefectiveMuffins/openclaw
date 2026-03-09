import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withEnvAsync } from "../test-utils/env.js";
import type { EmbeddedRunAttemptResult } from "./pi-embedded-runner/run/types.js";

const runEmbeddedAttemptMock = vi.fn<(params: unknown) => Promise<EmbeddedRunAttemptResult>>();

vi.mock("./pi-embedded-runner/run/attempt.js", () => ({
  runEmbeddedAttempt: (params: unknown) => runEmbeddedAttemptMock(params),
}));

vi.mock("./pi-embedded-runner/compact.js", () => ({
  compactEmbeddedPiSessionDirect: vi.fn(async () => {
    throw new Error("compact should not run in env-key rotation tests");
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
  sessionIdUsed: "session:test",
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

const makeConfig = (): OpenClawConfig =>
  ({
    models: {
      providers: {
        openai: {
          api: "openai-responses",
          apiKey: "",
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

const writeEmptyAuthStore = async (agentDir: string) => {
  const authPath = path.join(agentDir, "auth-profiles.json");
  await fs.writeFile(authPath, JSON.stringify({ version: 1, profiles: {}, usageStats: {} }));
};

async function withAgentWorkspace<T>(
  run: (ctx: { agentDir: string; workspaceDir: string }) => Promise<T>,
) {
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agent-"));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-"));
  try {
    return await run({ agentDir, workspaceDir });
  } finally {
    await fs.rm(agentDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

async function readUsageStats(agentDir: string) {
  const stored = JSON.parse(
    await fs.readFile(path.join(agentDir, "auth-profiles.json"), "utf-8"),
  ) as {
    usageStats?: Record<string, unknown>;
  };
  return stored.usageStats ?? {};
}

function mockFailedThenSuccessfulAttempt(errorMessage: string) {
  runEmbeddedAttemptMock
    .mockResolvedValueOnce(
      makeAttempt({
        assistantTexts: [],
        lastAssistant: buildAssistant({
          stopReason: "error",
          errorMessage,
        }),
      }),
    )
    .mockResolvedValueOnce(
      makeAttempt({
        assistantTexts: ["ok"],
        lastAssistant: buildAssistant({
          stopReason: "stop",
          content: [{ type: "text", text: "ok" }],
        }),
      }),
    );
}

function mockSingleErrorAttempt(errorMessage: string) {
  runEmbeddedAttemptMock.mockResolvedValueOnce(
    makeAttempt({
      assistantTexts: [],
      lastAssistant: buildAssistant({
        stopReason: "error",
        errorMessage,
      }),
    }),
  );
}

describe("runEmbeddedPiAgent env API-key rotation", () => {
  it("rotates across env API keys on retryable rate limits", async () => {
    await withEnvAsync(
      {
        OPENAI_API_KEY: "sk-env-one",
        OPENAI_API_KEY_2: "sk-env-two",
      },
      async () => {
        await withAgentWorkspace(async ({ agentDir, workspaceDir }) => {
          await writeEmptyAuthStore(agentDir);
          mockFailedThenSuccessfulAttempt("429 rate limit");

          await runEmbeddedPiAgent({
            sessionId: "session:test",
            sessionKey: "subagent:test:env-key-rate-limit",
            sessionFile: path.join(workspaceDir, "session.jsonl"),
            workspaceDir,
            agentDir,
            config: makeConfig(),
            prompt: "hello",
            provider: "openai",
            model: "mock-1",
            authProfileIdSource: "auto",
            timeoutMs: 5_000,
            runId: "run:env-key-rate-limit",
          });

          expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
          expect(await readUsageStats(agentDir)).toEqual({});
        });
      },
    );
  });

  it("rotates across env API keys on billing failures", async () => {
    await withEnvAsync(
      {
        OPENAI_API_KEY: "sk-env-one",
        OPENAI_API_KEY_2: "sk-env-two",
      },
      async () => {
        await withAgentWorkspace(async ({ agentDir, workspaceDir }) => {
          await writeEmptyAuthStore(agentDir);
          mockFailedThenSuccessfulAttempt("payment required");

          await runEmbeddedPiAgent({
            sessionId: "session:test",
            sessionKey: "subagent:test:env-key-billing",
            sessionFile: path.join(workspaceDir, "session.jsonl"),
            workspaceDir,
            agentDir,
            config: makeConfig(),
            prompt: "hello",
            provider: "openai",
            model: "mock-1",
            authProfileIdSource: "auto",
            timeoutMs: 5_000,
            runId: "run:env-key-billing",
          });

          expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(2);
          expect(await readUsageStats(agentDir)).toEqual({});
        });
      },
    );
  });

  it("does not rotate env API keys on non-retryable validation errors", async () => {
    await withEnvAsync(
      {
        OPENAI_API_KEY: "sk-env-one",
        OPENAI_API_KEY_2: "sk-env-two",
      },
      async () => {
        await withAgentWorkspace(async ({ agentDir, workspaceDir }) => {
          await writeEmptyAuthStore(agentDir);
          mockSingleErrorAttempt("400 invalid request body");

          await runEmbeddedPiAgent({
            sessionId: "session:test",
            sessionKey: "subagent:test:env-key-validation",
            sessionFile: path.join(workspaceDir, "session.jsonl"),
            workspaceDir,
            agentDir,
            config: makeConfig(),
            prompt: "hello",
            provider: "openai",
            model: "mock-1",
            authProfileIdSource: "auto",
            timeoutMs: 5_000,
            runId: "run:env-key-validation",
          });

          expect(runEmbeddedAttemptMock).toHaveBeenCalledTimes(1);
          expect(await readUsageStats(agentDir)).toEqual({});
        });
      },
    );
  });
});

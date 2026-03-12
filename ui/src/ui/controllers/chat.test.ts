import { describe, expect, it, vi } from "vitest";
import {
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

type HistoryResponse = { messages: unknown[]; thinkingLevel: string };
type HistoryResolver = (value: HistoryResponse) => void;

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("loadChatHistory", () => {
  it("ignores stale responses after the session changes", async () => {
    let resolveRequest: HistoryResolver | null = null;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<HistoryResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatMessages: [
        { role: "assistant", content: [{ type: "text", text: "keep" }], timestamp: 1 },
      ],
    });

    const pending = loadChatHistory(state);
    state.sessionKey = "other";
    if (!resolveRequest) {
      throw new Error("expected loadChatHistory request");
    }
    (resolveRequest as HistoryResolver)({
      messages: [{ role: "assistant", content: [{ type: "text", text: "stale" }], timestamp: 2 }],
      thinkingLevel: "low",
    });
    await pending;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "keep" }], timestamp: 1 },
    ]);
    expect(state.chatThinkingLevel).toBeNull();
  });

  it("ignores older same-session responses when a newer history load wins", async () => {
    let resolveFirst: HistoryResolver | null = null;
    let resolveSecond: HistoryResolver | null = null;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<HistoryResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<HistoryResponse>((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const state = createState({
      client: { request } as unknown as ChatState["client"],
    });

    const first = loadChatHistory(state);
    const second = loadChatHistory(state);

    const firstResolver = resolveFirst as HistoryResolver | null;
    const secondResolver = resolveSecond as HistoryResolver | null;
    if (!firstResolver || !secondResolver) {
      throw new Error("expected both loadChatHistory requests");
    }

    secondResolver({
      messages: [{ role: "assistant", content: [{ type: "text", text: "new" }], timestamp: 2 }],
      thinkingLevel: "high",
    });
    await second;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "new" }], timestamp: 2 },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
    expect(state.chatLoading).toBe(false);

    firstResolver({
      messages: [{ role: "assistant", content: [{ type: "text", text: "old" }], timestamp: 1 }],
      thinkingLevel: "low",
    });
    await first;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "new" }], timestamp: 2 },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
    expect(state.chatLoading).toBe(false);
  });

  it("ignores an in-flight history response after a live final updates chat state", async () => {
    let resolveRequest: HistoryResolver | null = null;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<HistoryResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const state = createState({
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
      chatRunId: "run-1",
      chatStream: "live reply",
      chatStreamStartedAt: 10,
    });

    const pending = loadChatHistory(state);
    handleChatEvent(state, {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "live reply" }],
        timestamp: 2,
      },
    });

    const resolver = resolveRequest as HistoryResolver | null;
    if (!resolver) {
      throw new Error("expected loadChatHistory request");
    }
    resolver({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
      thinkingLevel: "low",
    });
    await pending;

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "live reply" }],
        timestamp: 2,
      },
    ]);
    expect(state.chatThinkingLevel).toBeNull();
    expect(state.chatLoading).toBe(false);
  });
});
describe("sendChatMessage", () => {
  it("replaces visible history for bare reset commands", async () => {
    const state = createState({
      client: {
        request: vi.fn().mockResolvedValue({ ok: true }),
      } as unknown as ChatState["client"],
      chatMessages: [
        { role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: 2 },
      ],
    });

    const runId = await sendChatMessage(state, "/new", undefined, {
      replaceHistory: true,
      optimisticMessage: null,
    });

    expect(runId).toBeTruthy();
    expect(state.chatMessages).toEqual([]);
    expect(state.chatStream).toBe("");
    expect(state.chatRunId).toBeTruthy();
  });

  it("keeps only the post-reset prompt when reset includes new text", async () => {
    const state = createState({
      client: {
        request: vi.fn().mockResolvedValue({ ok: true }),
      } as unknown as ChatState["client"],
      chatMessages: [{ role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 }],
    });

    await sendChatMessage(state, "/reset check status", undefined, {
      replaceHistory: true,
      optimisticMessage: "check status",
    });

    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "check status" }],
    });
  });
});
describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("appends final payload from another run without clearing active stream", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toEqual(payload.message);
  });

  it("returns final for another run when payload has no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatMessages).toEqual([]);
  });

  it("persists streamed text when final event carries no message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Here is my reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Here is my reply" }],
    });
  });

  it("does not persist empty or whitespace-only stream on final", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "   ",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatMessages).toEqual([]);
  });

  it("does not persist null stream on final with no message", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: null,
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([]);
  });

  it("prefers final payload message over streamed text", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Streamed partial",
      chatStreamStartedAt: 100,
    });
    const finalMsg = {
      role: "assistant",
      content: [{ type: "text", text: "Complete reply" }],
      timestamp: 101,
    };
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: finalMsg,
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([finalMsg]);
    expect(state.chatStream).toBe(null);
  });

  it("appends final payload message from own run before clearing stream state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Reply" }],
        timestamp: 101,
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatMessages).toEqual([payload.message]);
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial when aborted payload message is invalid", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: "not-an-assistant-message",
    } as unknown as ChatEventPayload;

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[0]).toEqual(existingMessage);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("falls back to streamed partial when aborted payload has non-assistant role", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "user",
        content: [{ type: "text", text: "unexpected" }],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
    });
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });
});

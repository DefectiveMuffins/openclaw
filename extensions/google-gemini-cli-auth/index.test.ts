import { beforeEach, describe, expect, it, vi } from "vitest";

const { loginGeminiCliOAuthMock } = vi.hoisted(() => ({
  loginGeminiCliOAuthMock: vi.fn(),
}));

vi.mock("./oauth.js", () => ({
  loginGeminiCliOAuth: loginGeminiCliOAuthMock,
}));

import plugin from "./index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("google-gemini-cli-auth plugin", () => {
  it("binds note callbacks to the wizard prompter", async () => {
    loginGeminiCliOAuthMock.mockImplementation(async (ctx) => {
      await ctx.note("OAuth note", "Gemini CLI OAuth");
      return {
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
        email: "dev@example.com",
        projectId: "project-id",
      };
    });

    let provider: { auth: Array<{ run: (ctx: unknown) => Promise<unknown> }> } | undefined;
    (plugin as { register: (api: unknown) => void }).register({
      registerProvider: (entry: unknown) => {
        provider = entry as typeof provider;
      },
    });

    const note = vi.fn(async () => undefined);
    const text = vi.fn(async () => "");
    const progress = {
      update: vi.fn(),
      stop: vi.fn(),
    };

    await provider?.auth[0]?.run({
      config: {},
      prompter: {
        note,
        text,
        progress: () => progress,
      },
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      },
      isRemote: true,
      openUrl: vi.fn(),
      oauth: {
        createVpsAwareHandlers: vi.fn(),
      },
    });

    expect(note).toHaveBeenCalledWith("OAuth note", "Gemini CLI OAuth");
    expect(text).not.toHaveBeenCalled();
  });
});

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ConnectErrorDetailCodes } from "../../../../src/gateway/protocol/connect-error-details.js";
import { renderOverview } from "./overview.ts";

describe("overview view", () => {
  it("renders separate transport, authentication, and authorization states", () => {
    const container = document.createElement("div");
    render(
      renderOverview({
        connected: false,
        hello: { snapshot: { authMode: "token" } } as unknown as Parameters<
          typeof renderOverview
        >[0]["hello"],
        settings: {
          gatewayUrl: "ws://127.0.0.1:18789",
          token: "secret-token",
          sessionKey: "main",
          lastActiveSessionKey: "main",
          theme: "system",
          chatFocusMode: false,
          chatShowThinking: true,
          splitRatio: 0.6,
          navCollapsed: false,
          navGroupsCollapsed: {},
        },
        password: "",
        lastError: "unauthorized",
        lastErrorCode: ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH,
        presenceCount: 0,
        sessionsCount: 0,
        cronEnabled: null,
        cronNext: null,
        lastChannelsRefresh: null,
        onSettingsChange: vi.fn(),
        onPasswordChange: vi.fn(),
        onSessionKeyChange: vi.fn(),
        onConnect: vi.fn(),
        onRefresh: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("Transport");
    expect(container.textContent).toContain("Offline");
    expect(container.textContent).toContain("Authentication");
    expect(container.textContent).toContain("Token ready");
    expect(container.textContent).toContain("Authorization");
    expect(container.textContent).toContain("Rejected");
  });
});

import { describe, expect, it } from "vitest";
import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../src/gateway/events.js";
import { createGatewayClientHandlers } from "./app-gateway.ts";

type GatewayHost = Parameters<typeof createGatewayClientHandlers>[0];

function createHost(): GatewayHost {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
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
    clientInstanceId: "instance-test",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
  } as unknown as GatewayHost;
}

describe("createGatewayClientHandlers", () => {
  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();
    const staleHandlers = createGatewayClientHandlers(host, () => false);
    const activeHandlers = createGatewayClientHandlers(host, () => true);

    staleHandlers.onGap?.({ expected: 10, received: 13 });
    expect(host.lastError).toBeNull();

    activeHandlers.onGap?.({ expected: 20, received: 24 });
    expect(host.lastError).toBe(
      "event gap detected (expected seq 20, got 24); refresh recommended",
    );
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();
    const staleHandlers = createGatewayClientHandlers(host, () => false);
    const activeHandlers = createGatewayClientHandlers(host, () => true);

    staleHandlers.onEvent?.({
      type: "event",
      event: "presence",
      payload: { presence: [{ host: "stale" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(0);

    activeHandlers.onEvent?.({
      type: "event",
      event: "presence",
      payload: { presence: [{ host: "active" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });

  it("applies update.available only from active client", () => {
    const host = createHost();
    const staleHandlers = createGatewayClientHandlers(host, () => false);
    const activeHandlers = createGatewayClientHandlers(host, () => true);

    staleHandlers.onEvent?.({
      type: "event",
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "9.9.9", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toBeNull();

    activeHandlers.onEvent?.({
      type: "event",
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "2.0.0", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      channel: "latest",
    });
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();
    const staleHandlers = createGatewayClientHandlers(host, () => false);
    const activeHandlers = createGatewayClientHandlers(host, () => true);

    staleHandlers.onClose?.({ code: 1005, reason: "" });
    expect(host.lastError).toBeNull();
    expect(host.lastErrorCode).toBeNull();

    activeHandlers.onClose?.({ code: 1005, reason: "" });
    expect(host.lastError).toBe("disconnected (1005): no reason");
    expect(host.lastErrorCode).toBeNull();
  });

  it("prefers structured connect errors over close reason", () => {
    const host = createHost();
    const handlers = createGatewayClientHandlers(host, () => true);

    handlers.onClose?.({
      code: 4008,
      reason: "connect failed",
      error: {
        code: "INVALID_REQUEST",
        message:
          "unauthorized: gateway token mismatch (open the dashboard URL and paste the token in Control UI settings)",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });

    expect(host.lastError).toContain("gateway token mismatch");
    expect(host.lastErrorCode).toBe("AUTH_TOKEN_MISMATCH");
  });
});

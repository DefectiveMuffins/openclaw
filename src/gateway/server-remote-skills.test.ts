import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const registerSkillsChangeListener = vi.hoisted(() => vi.fn());
const primeRemoteSkillsCache = vi.hoisted(() => vi.fn());
const refreshRemoteBinsForConnectedNodes = vi.hoisted(() => vi.fn());
const setSkillsRemoteRegistry = vi.hoisted(() => vi.fn());

vi.mock("../agents/skills/refresh.js", () => ({
  registerSkillsChangeListener: (...args: Parameters<typeof registerSkillsChangeListener>) =>
    registerSkillsChangeListener(...args),
}));

vi.mock("../infra/skills-remote.js", () => ({
  primeRemoteSkillsCache: (...args: Parameters<typeof primeRemoteSkillsCache>) =>
    primeRemoteSkillsCache(...args),
  refreshRemoteBinsForConnectedNodes: (
    ...args: Parameters<typeof refreshRemoteBinsForConnectedNodes>
  ) => refreshRemoteBinsForConnectedNodes(...args),
  setSkillsRemoteRegistry: (...args: Parameters<typeof setSkillsRemoteRegistry>) =>
    setSkillsRemoteRegistry(...args),
}));

import { startGatewayRemoteSkillsSync } from "./server-remote-skills.js";

describe("startGatewayRemoteSkillsSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns an inert stop hook when disabled", () => {
    const sync = startGatewayRemoteSkillsSync({
      enabled: false,
      nodeRegistry: {} as never,
      loadConfig: () => ({}) as OpenClawConfig,
    });

    sync.stop();

    expect(setSkillsRemoteRegistry).not.toHaveBeenCalled();
    expect(primeRemoteSkillsCache).not.toHaveBeenCalled();
    expect(registerSkillsChangeListener).not.toHaveBeenCalled();
  });

  it("primes the remote registry and debounces non-remote skills changes", () => {
    const unsubscribe = vi.fn();
    let listener: ((event: { reason: "watch" | "manual" | "remote-node" }) => void) | undefined;
    registerSkillsChangeListener.mockImplementationOnce((next) => {
      listener = next;
      return unsubscribe;
    });
    const cfg = { gateway: {} } as OpenClawConfig;
    const nodeRegistry = { id: "registry" } as never;
    const sync = startGatewayRemoteSkillsSync({
      enabled: true,
      nodeRegistry,
      loadConfig: () => cfg,
      refreshDelayMs: 100,
    });

    expect(setSkillsRemoteRegistry).toHaveBeenCalledWith(nodeRegistry);
    expect(primeRemoteSkillsCache).toHaveBeenCalledTimes(1);
    expect(listener).toBeTypeOf("function");

    listener?.({ reason: "remote-node" });
    vi.advanceTimersByTime(100);
    expect(refreshRemoteBinsForConnectedNodes).not.toHaveBeenCalled();

    listener?.({ reason: "watch" });
    listener?.({ reason: "manual" });
    vi.advanceTimersByTime(99);
    expect(refreshRemoteBinsForConnectedNodes).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refreshRemoteBinsForConnectedNodes).toHaveBeenCalledTimes(1);
    expect(refreshRemoteBinsForConnectedNodes).toHaveBeenCalledWith(cfg);

    listener?.({ reason: "watch" });
    sync.stop();
    vi.runOnlyPendingTimers();

    expect(refreshRemoteBinsForConnectedNodes).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(setSkillsRemoteRegistry).toHaveBeenLastCalledWith(null);
  });
});

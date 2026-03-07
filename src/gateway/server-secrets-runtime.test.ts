import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const prepareSecretsRuntimeSnapshot = vi.hoisted(() => vi.fn());
const activateSecretsRuntimeSnapshot = vi.hoisted(() => vi.fn());

vi.mock("../secrets/runtime.js", () => ({
  prepareSecretsRuntimeSnapshot: (...args: Parameters<typeof prepareSecretsRuntimeSnapshot>) =>
    prepareSecretsRuntimeSnapshot(...args),
  activateSecretsRuntimeSnapshot: (...args: Parameters<typeof activateSecretsRuntimeSnapshot>) =>
    activateSecretsRuntimeSnapshot(...args),
}));

import { createGatewaySecretsActivator } from "./server-secrets-runtime.js";

describe("createGatewaySecretsActivator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a degraded event on reload failures and preserves the original error", async () => {
    const cfg = { gateway: {} } as OpenClawConfig;
    const err = new Error("vault offline");
    prepareSecretsRuntimeSnapshot.mockRejectedValueOnce(err);
    const logSecrets = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };
    const emitStateEvent = vi.fn();
    const { activateRuntimeSecrets } = createGatewaySecretsActivator({
      logSecrets,
      emitStateEvent,
    });

    await expect(activateRuntimeSecrets(cfg, { reason: "reload", activate: true })).rejects.toThrow(
      "vault offline",
    );
    expect(logSecrets.error).toHaveBeenCalledWith(
      "[SECRETS_RELOADER_DEGRADED] Error: vault offline",
    );
    expect(emitStateEvent).toHaveBeenCalledWith(
      "SECRETS_RELOADER_DEGRADED",
      "Secret resolution failed; runtime remains on last-known-good snapshot. Error: vault offline",
      cfg,
    );
    expect(activateSecretsRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it("emits a recovered event after a degraded reload succeeds", async () => {
    const cfg = { gateway: {} } as OpenClawConfig;
    const prepared = {
      config: cfg,
      warnings: [{ code: "WARN_CODE", message: "watch this" }],
    };
    prepareSecretsRuntimeSnapshot
      .mockRejectedValueOnce(new Error("vault offline"))
      .mockResolvedValueOnce(prepared);
    const logSecrets = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };
    const emitStateEvent = vi.fn();
    const { activateRuntimeSecrets } = createGatewaySecretsActivator({
      logSecrets,
      emitStateEvent,
    });

    await expect(activateRuntimeSecrets(cfg, { reason: "reload", activate: true })).rejects.toThrow(
      "vault offline",
    );
    await expect(
      activateRuntimeSecrets(cfg, { reason: "reload", activate: true }),
    ).resolves.toEqual(prepared);

    expect(logSecrets.warn).toHaveBeenCalledWith("[WARN_CODE] watch this");
    expect(logSecrets.info).toHaveBeenCalledWith(
      "[SECRETS_RELOADER_RECOVERED] Secret resolution recovered; runtime remained on last-known-good during the outage.",
    );
    expect(emitStateEvent).toHaveBeenLastCalledWith(
      "SECRETS_RELOADER_RECOVERED",
      "Secret resolution recovered; runtime remained on last-known-good during the outage.",
      cfg,
    );
    expect(activateSecretsRuntimeSnapshot).toHaveBeenCalledWith(prepared);
  });
});

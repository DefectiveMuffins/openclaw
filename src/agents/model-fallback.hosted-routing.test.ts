import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const resolveHostedRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("./hosted-routing.js", () => ({
  resolveHostedRouting: resolveHostedRoutingMock,
}));

import { runWithModelFallback } from "./model-fallback.js";

function makeCfg(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/mock-primary",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
  } as OpenClawConfig;
}

describe("runWithModelFallback hosted routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveHostedRoutingMock.mockResolvedValue({
      enabled: true,
      mode: "prefer-hosted",
      configuredOrder: ["google"],
      effectiveOrder: ["google"],
      appendConfiguredModels: true,
      availableCandidates: [{ provider: "google", model: "gemini-3-pro-preview" }],
      providers: [],
      skippedProviders: [],
    });
  });

  it("prepends hosted candidates before configured local models", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockRejectedValueOnce(new Error("auth"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg: makeCfg(),
      provider: "openai",
      model: "mock-primary",
      hostedRoutingEligible: true,
      run,
    });

    expect(result.result).toBe("ok");
    expect(run.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["google", "gemini-3-pro-preview"],
      ["openai", "mock-primary"],
      ["anthropic", "claude-haiku-3-5"],
    ]);
  });

  it("dedupes hosted candidates that match configured models", async () => {
    resolveHostedRoutingMock.mockResolvedValueOnce({
      enabled: true,
      mode: "prefer-hosted",
      configuredOrder: ["openai"],
      effectiveOrder: ["openai"],
      appendConfiguredModels: true,
      availableCandidates: [{ provider: "openai", model: "mock-primary" }],
      providers: [],
      skippedProviders: [],
    });
    const run = vi.fn().mockRejectedValueOnce(new Error("rate limit")).mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg: makeCfg(),
      provider: "openai",
      model: "mock-primary",
      hostedRoutingEligible: true,
      run,
    });

    expect(result.result).toBe("ok");
    expect(run.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["openai", "mock-primary"],
      ["anthropic", "claude-haiku-3-5"],
    ]);
  });

  it("bypasses hosted routing when the caller marked the model as explicitly overridden", async () => {
    const run = vi.fn().mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg: makeCfg(),
      provider: "openai",
      model: "mock-primary",
      hostedRoutingEligible: false,
      run,
    });

    expect(result.result).toBe("ok");
    expect(resolveHostedRoutingMock).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      "openai",
      "mock-primary",
      expect.objectContaining({ attempt: 1, total: 2 }),
    );
  });
});

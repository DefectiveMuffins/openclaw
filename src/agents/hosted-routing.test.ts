import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(() => ({ profiles: {}, usageStats: {} })),
  listProfilesForProvider: vi.fn(() => [] as string[]),
  resolveEnvApiKey: vi.fn<(provider: string) => { apiKey: string; source: string } | null>(
    () => null,
  ),
  getCustomProviderApiKey: vi.fn(() => undefined),
  loadModelCatalog: vi.fn(async () => [] as Array<{ provider: string; id: string }>),
}));

vi.mock("./auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
  listProfilesForProvider: mocks.listProfilesForProvider,
}));

vi.mock("./model-auth.js", () => ({
  resolveEnvApiKey: mocks.resolveEnvApiKey,
  getCustomProviderApiKey: mocks.getCustomProviderApiKey,
}));

vi.mock("./model-catalog.js", () => ({
  loadModelCatalog: mocks.loadModelCatalog,
}));

import {
  applyHostedRoutingOnboardingConfig,
  HOSTED_ROUTING_DEFAULT_PROVIDER_ORDER,
  resolveHostedRouting,
} from "./hosted-routing.js";

function makeCatalogEntries() {
  return [
    { provider: "google-gemini-cli", id: "gemini-3-pro-preview" },
    { provider: "google", id: "gemini-3-pro-preview" },
    { provider: "qwen-portal", id: "coder-model" },
    { provider: "moonshot", id: "kimi-k2.5" },
    { provider: "kimi-coding", id: "k2p5" },
    { provider: "minimax-portal", id: "MiniMax-M2.5" },
    { provider: "github-copilot", id: "gpt-4o" },
    { provider: "openai-codex", id: "gpt-5.3-codex" },
  ];
}

describe("hosted routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureAuthProfileStore.mockReturnValue({ profiles: {}, usageStats: {} });
    mocks.listProfilesForProvider.mockReturnValue([]);
    mocks.resolveEnvApiKey.mockReturnValue(null);
    mocks.getCustomProviderApiKey.mockReturnValue(undefined);
    mocks.loadModelCatalog.mockResolvedValue(makeCatalogEntries());
  });

  it("uses the default free-first order when no provider order is configured", async () => {
    mocks.resolveEnvApiKey.mockImplementation((provider: string) => {
      if (provider === "google") {
        return { apiKey: "gemini-key", source: "env: GEMINI_API_KEY" };
      }
      return null;
    });

    const resolution = await resolveHostedRouting({
      cfg: {
        agents: {
          defaults: {
            hostedRouting: {
              enabled: true,
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(resolution.enabled).toBe(true);
    expect(resolution.effectiveOrder).toEqual(Array.from(HOSTED_ROUTING_DEFAULT_PROVIDER_ORDER));
    expect(resolution.availableCandidates).toEqual([
      { provider: "google", model: "gemini-3-pro-preview" },
    ]);
  });

  it("honors explicit order and blocks hosted candidates outside the allowlist", async () => {
    mocks.resolveEnvApiKey.mockImplementation((provider: string) => {
      if (provider === "moonshot" || provider === "google") {
        return { apiKey: `${provider}-key`, source: `env: ${provider.toUpperCase()}_API_KEY` };
      }
      return null;
    });

    const resolution = await resolveHostedRouting({
      cfg: {
        agents: {
          defaults: {
            hostedRouting: {
              enabled: true,
              providerOrder: ["moonshot", "google"],
            },
            models: {
              "google/gemini-3-pro-preview": {},
            },
          },
        },
      } as OpenClawConfig,
    });

    expect(resolution.effectiveOrder).toEqual(["moonshot", "google"]);
    expect(resolution.availableCandidates).toEqual([
      { provider: "google", model: "gemini-3-pro-preview" },
    ]);
    expect(resolution.skippedProviders).toContainEqual({
      provider: "moonshot",
      reason: ["not allowlisted"],
    });
  });

  it("adds hosted routing config and extends an existing allowlist during onboarding", () => {
    const cfg = applyHostedRoutingOnboardingConfig({
      cfg: {
        agents: {
          defaults: {
            models: {
              "openai/gpt-5.1": { alias: "GPT" },
            },
          },
        },
      } as OpenClawConfig,
      providerOrder: ["google", "qwen-portal", "moonshot"],
    });

    expect(cfg.agents?.defaults?.hostedRouting).toEqual({
      enabled: true,
      mode: "prefer-hosted",
      providerOrder: ["google", "qwen-portal", "moonshot"],
      appendConfiguredModels: true,
    });
    expect(cfg.agents?.defaults?.models).toMatchObject({
      "openai/gpt-5.1": { alias: "GPT" },
      "google/gemini-3-pro-preview": {},
      "qwen-portal/coder-model": {},
      "moonshot/kimi-k2.5": {},
    });
  });

  it("does not create a new allowlist when onboarding did not start with one", () => {
    const cfg = applyHostedRoutingOnboardingConfig({
      cfg: {},
      providerOrder: ["google"],
    });

    expect(cfg.agents?.defaults?.hostedRouting).toEqual({
      enabled: true,
      mode: "prefer-hosted",
      providerOrder: ["google"],
      appendConfiguredModels: true,
    });
    expect(cfg.agents?.defaults?.models).toBeUndefined();
  });
});

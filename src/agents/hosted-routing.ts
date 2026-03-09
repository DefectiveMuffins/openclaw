import type { OpenClawConfig } from "../config/config.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { getCustomProviderApiKey, resolveEnvApiKey } from "./model-auth.js";
import { loadModelCatalog, type ModelCatalogEntry } from "./model-catalog.js";
import {
  buildConfiguredAllowlistKeys,
  modelKey,
  normalizeProviderId,
  parseModelRef,
  resolveConfiguredModelRef,
  type ModelRef,
} from "./model-selection.js";

export type HostedRoutingMode = "prefer-hosted" | "hosted-only";
export type HostedRoutingSkipReason =
  | "no auth"
  | "not allowlisted"
  | "plugin removed"
  | "model missing from catalog"
  | "unknown provider";
export type HostedProviderRiskLabel = "official" | "unofficial";
export type HostedProviderAuthMode = "api-key" | "oauth" | "token" | "mixed";

export type HostedProviderRegistryEntry = {
  provider: string;
  label: string;
  defaultModelRef: string;
  authMode: HostedProviderAuthMode;
  riskLabel: HostedProviderRiskLabel;
  docsUrl: string;
  optInOnly?: boolean;
};

export type HostedProviderStatus = {
  provider: string;
  label: string;
  modelRef: string;
  authMode: HostedProviderAuthMode;
  riskLabel: HostedProviderRiskLabel;
  docsUrl: string;
  optInOnly: boolean;
  available: boolean;
  skipReasons: HostedRoutingSkipReason[];
};

export type HostedRoutingSettings = {
  enabled: boolean;
  mode: HostedRoutingMode;
  configuredOrder: string[];
  effectiveOrder: string[];
  appendConfiguredModels: boolean;
};

export type HostedRoutingResolution = HostedRoutingSettings & {
  providers: HostedProviderStatus[];
  availableCandidates: ModelRef[];
  skippedProviders: Array<{ provider: string; reason: HostedRoutingSkipReason[] }>;
};

export type HostedProvidersUiResolution = HostedRoutingSettings & {
  providers: HostedProviderStatus[];
};

export const HOSTED_ROUTING_DEFAULT_PROVIDER_ORDER = [
  "google-gemini-cli",
  "google",
  "qwen-portal",
  "moonshot",
  "kimi-coding",
] as const;

const HOSTED_PROVIDER_REGISTRY: Record<string, HostedProviderRegistryEntry> = {
  "google-gemini-cli": {
    provider: "google-gemini-cli",
    label: "Google Gemini CLI",
    defaultModelRef: "google-gemini-cli/gemini-3-pro-preview",
    authMode: "oauth",
    riskLabel: "unofficial",
    docsUrl: "https://docs.openclaw.ai/providers/google-gemini-cli",
  },
  google: {
    provider: "google",
    label: "Google Gemini",
    defaultModelRef: "google/gemini-3-pro-preview",
    authMode: "api-key",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/google",
  },
  "qwen-portal": {
    provider: "qwen-portal",
    label: "Qwen",
    defaultModelRef: "qwen-portal/coder-model",
    authMode: "oauth",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/qwen",
  },
  moonshot: {
    provider: "moonshot",
    label: "Moonshot",
    defaultModelRef: "moonshot/kimi-k2.5",
    authMode: "api-key",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/moonshot",
  },
  "kimi-coding": {
    provider: "kimi-coding",
    label: "Kimi Coding",
    defaultModelRef: "kimi-coding/k2p5",
    authMode: "api-key",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/kimi-coding",
  },
  "minimax-portal": {
    provider: "minimax-portal",
    label: "MiniMax",
    defaultModelRef: "minimax-portal/MiniMax-M2.5",
    authMode: "mixed",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/minimax",
    optInOnly: true,
  },
  "github-copilot": {
    provider: "github-copilot",
    label: "GitHub Copilot",
    defaultModelRef: "github-copilot/gpt-4o",
    authMode: "token",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/github-copilot",
    optInOnly: true,
  },
  "openai-codex": {
    provider: "openai-codex",
    label: "OpenAI Codex",
    defaultModelRef: "openai-codex/gpt-5.3-codex",
    authMode: "oauth",
    riskLabel: "official",
    docsUrl: "https://docs.openclaw.ai/providers/openai-codex",
    optInOnly: true,
  },
};

const REMOVED_HOSTED_PROVIDER_IDS = new Set(["google-antigravity"]);

function normalizeHostedProviderOrder(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of values) {
    const provider = normalizeProviderId(String(raw ?? ""));
    if (!provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    next.push(provider);
  }
  return next;
}

function buildHostedProviderUiOrder(effectiveOrder: string[]): string[] {
  return normalizeHostedProviderOrder([...effectiveOrder, ...Object.keys(HOSTED_PROVIDER_REGISTRY)]);
}

function modelExistsInCatalog(catalog: ModelCatalogEntry[], ref: ModelRef): boolean {
  const key = modelKey(ref.provider, ref.model);
  return catalog.some((entry) => modelKey(entry.provider, entry.id) === key);
}

function hasProviderAuth(params: {
  provider: string;
  cfg: OpenClawConfig;
  agentDir?: string;
}): boolean {
  const store = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  if (listProfilesForProvider(store, params.provider).length > 0) {
    return true;
  }
  if (resolveEnvApiKey(params.provider)) {
    return true;
  }
  return Boolean(getCustomProviderApiKey(params.cfg, params.provider));
}

function buildHostedProviderStatus(params: {
  provider: string;
  cfg: OpenClawConfig;
  agentDir?: string;
  allowlist: Set<string> | null;
  catalog: ModelCatalogEntry[];
}): HostedProviderStatus {
  const removed = REMOVED_HOSTED_PROVIDER_IDS.has(params.provider);
  const registry = HOSTED_PROVIDER_REGISTRY[params.provider];
  const modelRef = registry?.defaultModelRef ?? `${params.provider}/unknown`;
  const parsed = parseModelRef(modelRef, DEFAULT_PROVIDER);
  const skipReasons: HostedRoutingSkipReason[] = [];

  if (removed) {
    skipReasons.push("plugin removed");
  } else if (!registry || !parsed) {
    skipReasons.push("unknown provider");
  } else {
    if (
      !hasProviderAuth({
        provider: registry.provider,
        cfg: params.cfg,
        agentDir: params.agentDir,
      })
    ) {
      skipReasons.push("no auth");
    }
    if (params.allowlist && !params.allowlist.has(modelKey(parsed.provider, parsed.model))) {
      skipReasons.push("not allowlisted");
    }
    if (!modelExistsInCatalog(params.catalog, parsed)) {
      skipReasons.push("model missing from catalog");
    }
  }

  return {
    provider: params.provider,
    label: registry?.label ?? params.provider,
    modelRef,
    authMode: registry?.authMode ?? "api-key",
    riskLabel: registry?.riskLabel ?? "official",
    docsUrl: registry?.docsUrl ?? "https://docs.openclaw.ai/providers",
    optInOnly: registry?.optInOnly === true,
    available: skipReasons.length === 0,
    skipReasons,
  };
}

async function resolveHostedProviderStatuses(params: {
  cfg: OpenClawConfig;
  agentDir?: string;
  providerOrder: string[];
}): Promise<Pick<HostedRoutingResolution, "providers" | "availableCandidates" | "skippedProviders">> {
  const primary = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const allowlist = buildConfiguredAllowlistKeys({
    cfg: params.cfg,
    defaultProvider: primary.provider,
  });
  const catalog = await loadModelCatalog({ config: params.cfg });
  const providers = params.providerOrder.map((provider) =>
    buildHostedProviderStatus({
      provider,
      cfg: params.cfg,
      agentDir: params.agentDir,
      allowlist,
      catalog,
    }),
  );
  const availableCandidates = providers
    .filter((entry) => entry.available)
    .map((entry) => parseModelRef(entry.modelRef, DEFAULT_PROVIDER))
    .filter((entry): entry is ModelRef => Boolean(entry));

  return {
    providers,
    availableCandidates,
    skippedProviders: providers
      .filter((entry) => entry.skipReasons.length > 0)
      .map((entry) => ({ provider: entry.provider, reason: entry.skipReasons })),
  };
}

export function getHostedProviderRegistry(): Record<string, HostedProviderRegistryEntry> {
  return HOSTED_PROVIDER_REGISTRY;
}

export function resolveHostedRoutingSettings(
  cfg: OpenClawConfig | undefined,
): HostedRoutingSettings {
  const hostedRouting = cfg?.agents?.defaults?.hostedRouting;
  const configuredOrder = normalizeHostedProviderOrder(hostedRouting?.providerOrder ?? []);
  const effectiveOrder =
    configuredOrder.length > 0
      ? configuredOrder
      : Array.from(HOSTED_ROUTING_DEFAULT_PROVIDER_ORDER);

  return {
    enabled: hostedRouting?.enabled === true,
    mode: hostedRouting?.mode === "hosted-only" ? "hosted-only" : "prefer-hosted",
    configuredOrder,
    effectiveOrder,
    appendConfiguredModels: hostedRouting?.appendConfiguredModels !== false,
  };
}

export async function resolveHostedRouting(params: {
  cfg: OpenClawConfig;
  agentDir?: string;
}): Promise<HostedRoutingResolution> {
  const settings = resolveHostedRoutingSettings(params.cfg);
  const resolved = await resolveHostedProviderStatuses({
    cfg: params.cfg,
    agentDir: params.agentDir,
    providerOrder: settings.effectiveOrder,
  });

  return {
    ...settings,
    ...resolved,
  };
}

export async function resolveHostedProvidersForUi(params: {
  cfg: OpenClawConfig;
  agentDir?: string;
}): Promise<HostedProvidersUiResolution> {
  const settings = resolveHostedRoutingSettings(params.cfg);
  const resolved = await resolveHostedProviderStatuses({
    cfg: params.cfg,
    agentDir: params.agentDir,
    providerOrder: buildHostedProviderUiOrder(settings.effectiveOrder),
  });

  return {
    ...settings,
    providers: resolved.providers,
  };
}

export function ensureHostedProviderAllowlisted(
  cfg: OpenClawConfig,
  provider: string,
): OpenClawConfig {
  const registry = HOSTED_PROVIDER_REGISTRY[provider];
  const existingModels = cfg.agents?.defaults?.models;
  if (!registry || !existingModels) {
    return cfg;
  }
  if (existingModels[registry.defaultModelRef]) {
    return cfg;
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models: {
          ...existingModels,
          [registry.defaultModelRef]: {},
        },
      },
    },
  };
}

export function applyHostedRoutingOnboardingConfig(params: {
  cfg: OpenClawConfig;
  providerOrder?: string[];
}): OpenClawConfig {
  const providerOrder = normalizeHostedProviderOrder(
    params.providerOrder?.length ? params.providerOrder : HOSTED_ROUTING_DEFAULT_PROVIDER_ORDER,
  );
  const defaults = params.cfg.agents?.defaults;
  const existingModels = defaults?.models;
  const nextModels = existingModels ? { ...existingModels } : undefined;

  if (nextModels) {
    for (const provider of providerOrder) {
      const registry = HOSTED_PROVIDER_REGISTRY[provider];
      if (!registry) {
        continue;
      }
      nextModels[registry.defaultModelRef] = nextModels[registry.defaultModelRef] ?? {};
    }
  }

  return {
    ...params.cfg,
    agents: {
      ...params.cfg.agents,
      defaults: {
        ...defaults,
        hostedRouting: {
          ...(defaults?.hostedRouting ?? {}),
          enabled: true,
          mode: "prefer-hosted",
          providerOrder,
          appendConfiguredModels: true,
        },
        ...(nextModels ? { models: nextModels } : {}),
      },
    },
  };
}
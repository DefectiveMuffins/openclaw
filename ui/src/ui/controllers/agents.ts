import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AgentsListResult,
  ConfigSnapshot,
  GatewayModelChoice,
  ToolsCatalogResult,
} from "../types.ts";
import { updateConfigFormValue } from "./config.ts";

const LMSTUDIO_PROVIDER_ID = "lmstudio";
const LMSTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
const LMSTUDIO_DEFAULT_CONTEXT_WINDOW = 131072;
const LMSTUDIO_DEFAULT_MAX_TOKENS = 8192;
const ZERO_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

type GatewayModelChoiceInput = "text" | "image" | "document";

type ProviderModelDefinition = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: typeof ZERO_COST;
  contextWindow: number;
  maxTokens: number;
};

type ProviderConfigDraft = {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: ProviderModelDefinition[];
  [key: string]: unknown;
};

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  agentModelChoices: GatewayModelChoice[];
  agentModelDiscoveryLoading: boolean;
  agentModelDiscoveryError: string | null;
  agentModelDiscoveryImportedCount: number | null;
  configForm: Record<string, unknown> | null;
  configSnapshot: ConfigSnapshot | null;
  configFormMode: "form" | "raw";
  configRaw: string;
  configFormDirty: boolean;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
};

function normalizeGatewayModelChoices(models: unknown[]): GatewayModelChoice[] {
  const seen = new Set<string>();
  return models.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const provider =
      typeof (entry as { provider?: unknown }).provider === "string"
        ? (entry as { provider: string }).provider.trim()
        : "";
    const id =
      typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.trim() : "";
    if (!provider || !id) {
      return [];
    }
    const key = `${provider}/${id}`.toLowerCase();
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    const name =
      typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim()
        : id;
    const contextWindow =
      typeof (entry as { contextWindow?: unknown }).contextWindow === "number" &&
      Number.isFinite((entry as { contextWindow?: number }).contextWindow)
        ? (entry as { contextWindow: number }).contextWindow
        : undefined;
    const reasoning =
      typeof (entry as { reasoning?: unknown }).reasoning === "boolean"
        ? (entry as { reasoning: boolean }).reasoning
        : undefined;
    const input = Array.isArray((entry as { input?: unknown }).input)
      ? ((entry as { input: unknown[] }).input.filter(
          (value): value is GatewayModelChoiceInput =>
            value === "text" || value === "image" || value === "document",
        ) as GatewayModelChoiceInput[])
      : undefined;
    return [
      {
        id,
        name: name || id,
        provider,
        ...(typeof contextWindow === "number" ? { contextWindow } : {}),
        ...(typeof reasoning === "boolean" ? { reasoning } : {}),
        ...(input && input.length > 0 ? { input } : {}),
      } satisfies GatewayModelChoice,
    ];
  });
}

function mergeModelChoices(
  existing: GatewayModelChoice[],
  discovered: GatewayModelChoice[],
): GatewayModelChoice[] {
  return normalizeGatewayModelChoices([...existing, ...discovered]);
}

function normalizeProviderModelInput(input?: GatewayModelChoiceInput[]): Array<"text" | "image"> {
  const normalized = new Set<"text" | "image">(["text"]);
  if (Array.isArray(input) && input.includes("image")) {
    normalized.add("image");
  }
  return [...normalized];
}

function sortProviderModelDefinitions(
  models: ProviderModelDefinition[],
): ProviderModelDefinition[] {
  return [...models].sort((left, right) => {
    const nameCmp = left.name.localeCompare(right.name);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildDiscoveredModelDefinitions(
  models: GatewayModelChoice[],
  existingRaw: unknown,
): ProviderModelDefinition[] {
  const merged = new Map<string, ProviderModelDefinition>();
  if (Array.isArray(existingRaw)) {
    for (const entry of existingRaw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const id =
        typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id.trim()
          : "";
      if (!id) {
        continue;
      }
      const inputValues = Array.isArray((entry as { input?: unknown }).input)
        ? (entry as { input: unknown[] }).input.filter(
            (value): value is "text" | "image" => value === "text" || value === "image",
          )
        : ["text"];
      merged.set(id, {
        id,
        name:
          typeof (entry as { name?: unknown }).name === "string" &&
          (entry as { name: string }).name.trim()
            ? (entry as { name: string }).name.trim()
            : id,
        reasoning:
          typeof (entry as { reasoning?: unknown }).reasoning === "boolean"
            ? (entry as { reasoning: boolean }).reasoning
            : false,
        input: inputValues.length > 0 ? inputValues : ["text"],
        cost:
          typeof (entry as { cost?: unknown }).cost === "object" &&
          (entry as { cost?: unknown }).cost
            ? ((entry as { cost: typeof ZERO_COST }).cost ?? ZERO_COST)
            : ZERO_COST,
        contextWindow:
          typeof (entry as { contextWindow?: unknown }).contextWindow === "number" &&
          Number.isFinite((entry as { contextWindow?: number }).contextWindow)
            ? (entry as { contextWindow: number }).contextWindow
            : LMSTUDIO_DEFAULT_CONTEXT_WINDOW,
        maxTokens:
          typeof (entry as { maxTokens?: unknown }).maxTokens === "number" &&
          Number.isFinite((entry as { maxTokens?: number }).maxTokens)
            ? (entry as { maxTokens: number }).maxTokens
            : LMSTUDIO_DEFAULT_MAX_TOKENS,
      });
    }
  }

  for (const model of models) {
    const previous = merged.get(model.id);
    merged.set(model.id, {
      id: model.id,
      name: model.name,
      reasoning: model.reasoning ?? previous?.reasoning ?? false,
      input: previous?.input ?? normalizeProviderModelInput(model.input),
      cost: previous?.cost ?? ZERO_COST,
      contextWindow:
        model.contextWindow ?? previous?.contextWindow ?? LMSTUDIO_DEFAULT_CONTEXT_WINDOW,
      maxTokens: previous?.maxTokens ?? LMSTUDIO_DEFAULT_MAX_TOKENS,
    });
  }

  return sortProviderModelDefinitions([...merged.values()]);
}

function mergeDiscoveredProviderConfig(
  providerId: string,
  existingRaw: unknown,
  models: GatewayModelChoice[],
): ProviderConfigDraft {
  const existing =
    existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
      ? ({ ...(existingRaw as Record<string, unknown>) } as ProviderConfigDraft)
      : {};
  const defaults =
    providerId === LMSTUDIO_PROVIDER_ID
      ? {
          baseUrl: LMSTUDIO_DEFAULT_BASE_URL,
          apiKey: "lmstudio",
          api: "openai-responses",
        }
      : {};
  return {
    ...defaults,
    ...existing,
    models: buildDiscoveredModelDefinitions(models, existing.models),
  };
}

function resolveProvidersConfig(config: Record<string, unknown>): Record<string, unknown> {
  const models = config.models;
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return {};
  }
  const providers = (models as { providers?: unknown }).providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return {};
  }
  return providers as Record<string, unknown>;
}

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadAgentModelChoices(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ models?: unknown[] }>("models.list", {
      includeAll: true,
    });
    const models = Array.isArray(res?.models) ? res.models : [];
    state.agentModelChoices = normalizeGatewayModelChoices(models);
  } catch {
    state.agentModelChoices = [];
  }
}

export async function discoverProviderModels(state: AgentsState, providerId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentModelDiscoveryLoading) {
    return;
  }
  state.agentModelDiscoveryLoading = true;
  state.agentModelDiscoveryError = null;
  state.agentModelDiscoveryImportedCount = null;
  try {
    const res = await state.client.request<{ providerId?: string; models?: unknown[] }>(
      "models.discoverProvider",
      { providerId },
    );
    const discovered = normalizeGatewayModelChoices(Array.isArray(res?.models) ? res.models : []);
    const effectiveProviderId =
      typeof res?.providerId === "string" && res.providerId.trim()
        ? res.providerId.trim()
        : providerId;
    state.agentModelChoices = mergeModelChoices(state.agentModelChoices, discovered);
    const baseConfig = (state.configForm ?? state.configSnapshot?.config ?? {}) as Record<
      string,
      unknown
    >;
    const providers = resolveProvidersConfig(baseConfig);
    const existingProvider = providers[effectiveProviderId];
    const providerConfig = mergeDiscoveredProviderConfig(
      effectiveProviderId,
      existingProvider,
      discovered,
    );
    updateConfigFormValue(
      state as Parameters<typeof updateConfigFormValue>[0],
      ["models", "providers", effectiveProviderId],
      providerConfig,
    );
    state.agentModelDiscoveryImportedCount = discovered.length;
  } catch (err) {
    state.agentModelDiscoveryError = String(err);
  } finally {
    state.agentModelDiscoveryLoading = false;
  }
}

export async function loadToolsCatalog(state: AgentsState, agentId?: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.toolsCatalogLoading) {
    return;
  }
  state.toolsCatalogLoading = true;
  state.toolsCatalogError = null;
  try {
    const res = await state.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: agentId ?? state.agentsSelectedId ?? undefined,
      includePlugins: true,
    });
    if (res) {
      state.toolsCatalogResult = res;
    }
  } catch (err) {
    state.toolsCatalogError = String(err);
  } finally {
    state.toolsCatalogLoading = false;
  }
}

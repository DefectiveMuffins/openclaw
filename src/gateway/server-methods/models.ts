import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildAllowedModelSet } from "../../agents/model-selection.js";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsDiscoverProviderParams,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const OPENAI_COMPAT_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);
const LMSTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
const LMSTUDIO_DEFAULT_API = "openai-responses";

type OpenAiCompatModelResponse = {
  data?: Array<{
    id?: unknown;
    name?: unknown;
  }>;
};

type ProviderConfigLike = {
  baseUrl?: unknown;
  api?: unknown;
  apiKey?: unknown;
};

type DiscoveryProviderConfig = {
  providerId: string;
  baseUrl: string;
  api: string;
  apiKey?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortModelChoices<T extends { provider: string; name: string; id: string }>(
  models: T[],
): T[] {
  return models.toSorted((left, right) => {
    const providerCmp = left.provider.localeCompare(right.provider);
    if (providerCmp !== 0) {
      return providerCmp;
    }
    const nameCmp = left.name.localeCompare(right.name);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return left.id.localeCompare(right.id);
  });
}

function resolveProviderConfigForDiscovery(
  cfg: OpenClawConfig,
  providerId: string,
): DiscoveryProviderConfig | null {
  const configured = cfg.models?.providers?.[providerId] as ProviderConfigLike | undefined;
  const configuredBaseUrl = normalizeString(configured?.baseUrl);
  const configuredApi = normalizeString(configured?.api);
  const configuredApiKey = normalizeString(configured?.apiKey);

  if (configuredBaseUrl) {
    return {
      providerId,
      baseUrl: configuredBaseUrl,
      api: configuredApi || LMSTUDIO_DEFAULT_API,
      apiKey: configuredApiKey || undefined,
    };
  }

  if (providerId === "lmstudio") {
    return {
      providerId,
      baseUrl: LMSTUDIO_DEFAULT_BASE_URL,
      api: LMSTUDIO_DEFAULT_API,
      apiKey: configuredApiKey || "lmstudio",
    };
  }

  return null;
}

function buildOpenAiCompatDiscoveryUrls(baseUrl: string): string[] {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return [];
  }
  const candidates = new Set<string>();
  if (trimmed.endsWith("/models")) {
    candidates.add(trimmed);
  } else {
    candidates.add(`${trimmed}/models`);
    if (!trimmed.endsWith("/v1")) {
      candidates.add(`${trimmed}/v1/models`);
    }
  }
  return [...candidates];
}

async function discoverOpenAiCompatModels(params: DiscoveryProviderConfig) {
  if (!OPENAI_COMPAT_APIS.has(params.api)) {
    throw new Error(
      `provider "${params.providerId}" uses unsupported api "${params.api}" for live discovery`,
    );
  }

  const headers: Record<string, string> = {};
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  let lastError: string | null = null;
  for (const url of buildOpenAiCompatDiscoveryUrls(params.baseUrl)) {
    try {
      const response = await fetch(url, {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        if (response.status === 404) {
          lastError = `HTTP ${response.status} for ${url}`;
          continue;
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const payload = (await response.json()) as OpenAiCompatModelResponse;
      const rows = Array.isArray(payload.data) ? payload.data : [];
      return sortModelChoices(
        rows.flatMap((row) => {
          const id = normalizeString(row?.id);
          if (!id) {
            return [];
          }
          const name = normalizeString(row?.name) || id;
          return [{ id, name, provider: params.providerId }];
        }),
      );
    } catch (error) {
      lastError = String(error);
    }
  }

  throw new Error(
    lastError
      ? `failed to discover models for provider "${params.providerId}": ${lastError}`
      : `failed to discover models for provider "${params.providerId}"`,
  );
}

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const includeAll = (params as { includeAll?: boolean }).includeAll === true;
      // Full-catalog requests back the Agents model picker and should reflect
      // fresh LM Studio / models.json changes without requiring a gateway restart.
      const catalog = await context.loadGatewayModelCatalog({ refresh: includeAll });
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = includeAll ? catalog : allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.discoverProvider": async ({ params, respond }) => {
    if (!validateModelsDiscoverProviderParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.discoverProvider params: ${formatValidationErrors(validateModelsDiscoverProviderParams.errors)}`,
        ),
      );
      return;
    }

    const providerId = normalizeString(
      (params as { providerId?: unknown }).providerId,
    ).toLowerCase();
    if (!providerId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "providerId is required"));
      return;
    }

    try {
      const cfg = loadConfig();
      const providerConfig = resolveProviderConfigForDiscovery(cfg, providerId);
      if (!providerConfig) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `provider "${providerId}" is not configured for model discovery`,
          ),
        );
        return;
      }
      const models = await discoverOpenAiCompatModels(providerConfig);
      respond(true, { providerId, models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};

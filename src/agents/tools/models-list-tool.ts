import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { resolveAgentConfig } from "../agent-scope.js";
import type { ModelCatalogEntry, ModelCostMetadata } from "../model-catalog.js";
import { loadModelCatalog } from "../model-catalog.js";
import {
  buildAllowedModelSet,
  buildModelAliasIndex,
  modelKey,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
  resolveSubagentConfiguredModelSelection,
} from "../model-selection.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam, ToolAuthorizationError } from "./common.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

const ModelsListToolSchema = Type.Object({
  agentId: Type.Optional(Type.String()),
});

type ModelsListEntry = {
  ref: string;
  provider: string;
  model: string;
  aliases: string[];
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow?: number;
  cost?: ModelCostMetadata;
  discovered: boolean;
};

type CostRank = {
  known: boolean;
  total?: number;
};

function normalizeCost(cost: unknown): ModelCostMetadata | undefined {
  if (!cost || typeof cost !== "object") {
    return undefined;
  }
  const typed = cost as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
  const input =
    typeof typed.input === "number" && Number.isFinite(typed.input) ? typed.input : undefined;
  const output =
    typeof typed.output === "number" && Number.isFinite(typed.output) ? typed.output : undefined;
  const cacheRead =
    typeof typed.cacheRead === "number" && Number.isFinite(typed.cacheRead)
      ? typed.cacheRead
      : undefined;
  const cacheWrite =
    typeof typed.cacheWrite === "number" && Number.isFinite(typed.cacheWrite)
      ? typed.cacheWrite
      : undefined;
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
  };
}

function resolveCostRank(cost: ModelCostMetadata | undefined): CostRank {
  if (!cost) {
    return { known: false };
  }
  return {
    known: true,
    total: cost.input + cost.output + cost.cacheRead + cost.cacheWrite,
  };
}

function resolveAliasesByModelKey(
  aliasesByKey: Map<string, string[]>,
  canonicalModelKey: string,
): string[] {
  const exact = aliasesByKey.get(canonicalModelKey);
  if (exact && exact.length > 0) {
    return exact.toSorted((a, b) => a.localeCompare(b));
  }
  const lowerKey = canonicalModelKey.toLowerCase();
  for (const [key, aliases] of aliasesByKey.entries()) {
    if (key.toLowerCase() !== lowerKey) {
      continue;
    }
    return aliases.toSorted((a, b) => a.localeCompare(b));
  }
  return [];
}

function buildModelsListEntries(params: {
  allowedCatalog: ModelCatalogEntry[];
  discoveredKeys: Set<string>;
  aliasesByKey: Map<string, string[]>;
}): ModelsListEntry[] {
  const entries = params.allowedCatalog.map((entry) => {
    const ref = modelKey(entry.provider, entry.id);
    const cost = normalizeCost(entry.cost);
    return {
      ref,
      provider: entry.provider,
      model: entry.id,
      aliases: resolveAliasesByModelKey(params.aliasesByKey, ref),
      name: entry.name,
      reasoning: entry.reasoning === true,
      input: Array.isArray(entry.input) && entry.input.length > 0 ? entry.input : ["text"],
      contextWindow:
        typeof entry.contextWindow === "number" && Number.isFinite(entry.contextWindow)
          ? entry.contextWindow
          : undefined,
      cost,
      discovered: params.discoveredKeys.has(ref),
    };
  });

  entries.sort((a, b) => {
    const aRank = resolveCostRank(a.cost);
    const bRank = resolveCostRank(b.cost);
    if (aRank.known !== bRank.known) {
      return aRank.known ? -1 : 1;
    }
    if (aRank.known && bRank.known && aRank.total !== bRank.total) {
      return (aRank.total ?? 0) - (bRank.total ?? 0);
    }
    return a.ref.localeCompare(b.ref);
  });

  return entries;
}

function ensureAgentTargetAllowed(params: {
  cfg: ReturnType<typeof loadConfig>;
  requesterAgentId: string;
  targetAgentId: string;
}): void {
  if (params.targetAgentId === params.requesterAgentId) {
    return;
  }

  const allowAgents =
    resolveAgentConfig(params.cfg, params.requesterAgentId)?.subagents?.allowAgents ?? [];
  const allowAny = allowAgents.some((value) => value.trim() === "*");
  const allowSet = new Set(
    allowAgents
      .filter((value) => value.trim() && value.trim() !== "*")
      .map((value) => normalizeAgentId(value).toLowerCase()),
  );

  if (!allowAny && !allowSet.has(params.targetAgentId.toLowerCase())) {
    throw new ToolAuthorizationError(
      `agentId is not allowed for models_list target resolution (target: ${params.targetAgentId})`,
    );
  }
}

function resolveRequesterAgentId(params: {
  cfg: ReturnType<typeof loadConfig>;
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
}): string {
  const { mainKey, alias } = resolveMainSessionAlias(params.cfg);
  const requesterInternalKey =
    typeof params.agentSessionKey === "string" && params.agentSessionKey.trim()
      ? resolveInternalSessionKey({
          key: params.agentSessionKey,
          alias,
          mainKey,
        })
      : alias;

  return normalizeAgentId(
    params.requesterAgentIdOverride ??
      parseAgentSessionKey(requesterInternalKey)?.agentId ??
      DEFAULT_AGENT_ID,
  );
}

export function createModelsListTool(opts?: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  config?: ReturnType<typeof loadConfig>;
}): AnyAgentTool {
  return {
    label: "Models",
    name: "models_list",
    description:
      "List available worker models for sessions_spawn model selection, sorted cheapest-known-first with capabilities and aliases.",
    parameters: ModelsListToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = opts?.config ?? loadConfig();
      const requesterAgentId = resolveRequesterAgentId({
        cfg,
        agentSessionKey: opts?.agentSessionKey,
        requesterAgentIdOverride: opts?.requesterAgentIdOverride,
      });

      const targetAgentIdRaw = readStringParam(params, "agentId");
      const targetAgentId = targetAgentIdRaw
        ? normalizeAgentId(targetAgentIdRaw)
        : requesterAgentId;

      ensureAgentTargetAllowed({
        cfg,
        requesterAgentId,
        targetAgentId,
      });

      const effectiveDefault = resolveDefaultModelForAgent({
        cfg,
        agentId: targetAgentId,
      });
      const effectiveDefaultRef = modelKey(effectiveDefault.provider, effectiveDefault.model);
      const configuredSubagentDefault = resolveSubagentConfiguredModelSelection({
        cfg,
        agentId: targetAgentId,
      });

      const aliasIndex = buildModelAliasIndex({
        cfg,
        defaultProvider: effectiveDefault.provider,
      });
      const resolvedConfiguredSubagentDefault = configuredSubagentDefault
        ? resolveModelRefFromString({
            raw: configuredSubagentDefault,
            defaultProvider: effectiveDefault.provider,
            aliasIndex,
          })
        : null;

      const catalog = await loadModelCatalog({ config: cfg });
      const allowed = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: effectiveDefault.provider,
        defaultModel: effectiveDefaultRef,
      });

      const discoveredKeys = new Set(catalog.map((entry) => modelKey(entry.provider, entry.id)));
      const availableAllowedCatalog = allowed.allowedCatalog.filter((entry) =>
        discoveredKeys.has(modelKey(entry.provider, entry.id)),
      );
      const models = buildModelsListEntries({
        allowedCatalog: availableAllowedCatalog,
        discoveredKeys,
        aliasesByKey: aliasIndex.byKey,
      });

      return jsonResult({
        requesterAgentId,
        targetAgentId,
        defaults: {
          effectiveDefaultModel: effectiveDefaultRef,
          configuredSubagentDefault: configuredSubagentDefault ?? undefined,
          resolvedConfiguredSubagentDefault: resolvedConfiguredSubagentDefault
            ? modelKey(
                resolvedConfiguredSubagentDefault.ref.provider,
                resolvedConfiguredSubagentDefault.ref.model,
              )
            : undefined,
        },
        allowAny: allowed.allowAny,
        models,
      });
    },
  };
}

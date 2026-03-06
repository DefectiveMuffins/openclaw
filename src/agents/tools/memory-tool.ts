import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import type { MemorySearchResult } from "../../memory/types.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import {
  estimateMemorySearchConfidence,
  packMemorySearchResults,
  resolveMemorySearchPlan,
  type MemorySearchSourceBias,
  type MemorySearchStrategy,
} from "../memory-search-routing.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import { optionalStringEnum } from "../schema/typebox.js";
import { searchWorkingSet } from "../tool-working-set.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MEMORY_SEARCH_STRATEGIES = ["auto", "fast", "deep"] as const;
const MEMORY_SEARCH_SOURCE_BIASES = ["balanced", "memory", "sessions", "working-set"] as const;

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
  strategy: Type.Optional(optionalStringEnum(MEMORY_SEARCH_STRATEGIES)),
  sourceBias: Type.Optional(optionalStringEnum(MEMORY_SEARCH_SOURCE_BIASES)),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

function resolveMemoryToolContext(options: { config?: OpenClawConfig; agentSessionKey?: string }) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

function makeResultKey(entry: MemorySearchResult): string {
  return `${entry.source}:${entry.path}:${entry.startLine}:${entry.endLine}:${entry.snippet.trim()}`;
}

function applySourceBias(entry: MemorySearchResult, sourceBias: MemorySearchSourceBias): number {
  if (sourceBias === "memory" && entry.source === "memory") {
    return 0.08;
  }
  if (sourceBias === "sessions" && entry.source === "sessions") {
    return 0.08;
  }
  if (sourceBias === "working-set" && entry.source === "working-set") {
    return 0.1;
  }
  return 0;
}

function mergeAndRankResults(params: {
  resultSets: MemorySearchResult[][];
  sourceBias: MemorySearchSourceBias;
}): MemorySearchResult[] {
  const deduped = new Map<string, MemorySearchResult>();
  for (const resultSet of params.resultSets) {
    for (const entry of resultSet) {
      const key = makeResultKey(entry);
      const candidate = { ...entry, score: Math.min(1, entry.score + applySourceBias(entry, params.sourceBias)) };
      const existing = deduped.get(key);
      if (!existing || candidate.score > existing.score) {
        deduped.set(key, candidate);
      }
    }
  }
  return [...deduped.values()].sort((a, b) => b.score - a.score);
}

function resolveConfidenceLevel(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) {
    return "high";
  }
  if (score >= 0.45) {
    return "medium";
  }
  return "low";
}

async function searchPersistentMemory(params: {
  cfg: OpenClawConfig;
  agentId: string;
  queryPlan: ReturnType<typeof resolveMemorySearchPlan>;
  requestedMaxResults: number;
  requestedMinScore: number;
  sessionKey?: string;
}): Promise<{
  results: MemorySearchResult[];
  provider?: string;
  model?: string;
  fallback?: unknown;
  mode?: string;
  error?: string;
}> {
  const { manager, error } = await getMemorySearchManager({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  if (!manager) {
    return { results: [], error };
  }

  try {
    const resultSets = await Promise.all(
      params.queryPlan.queries.map((query) =>
        manager.search(query, {
          maxResults: params.queryPlan.maxResults,
          minScore: params.queryPlan.minScore,
          sessionKey: params.sessionKey,
        }),
      ),
    );
    const status = manager.status();
    const mode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
    const merged = mergeAndRankResults({
      resultSets,
      sourceBias: params.queryPlan.sourceBias,
    });
    const packed = packMemorySearchResults({
      results: merged,
      maxResults: params.requestedMaxResults,
    });
    return {
      results: packed,
      provider: status.provider,
      model: status.model,
      fallback: status.fallback,
      mode,
    };
  } catch (err) {
    return {
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const requestedMaxResults = readNumberParam(params, "maxResults");
      const requestedMinScore = readNumberParam(params, "minScore");
      const requestedStrategy = readStringParam(params, "strategy") as MemorySearchStrategy | undefined;
      const requestedSourceBias = readStringParam(params, "sourceBias") as
        | MemorySearchSourceBias
        | undefined;
      const resolvedSearch = resolveMemorySearchConfig(cfg, agentId);
      if (!resolvedSearch) {
        return jsonResult(buildMemorySearchUnavailableResult(undefined));
      }
      const maxResults =
        typeof requestedMaxResults === "number" && Number.isFinite(requestedMaxResults)
          ? Math.max(1, Math.floor(requestedMaxResults))
          : resolvedSearch.query.maxResults;
      const minScore =
        typeof requestedMinScore === "number" && Number.isFinite(requestedMinScore)
          ? Math.max(0, Math.min(1, requestedMinScore))
          : resolvedSearch.query.minScore;
      const queryPlan = resolveMemorySearchPlan({
        query,
        requestedStrategy,
        sourceBias: requestedSourceBias,
        maxResults,
        minScore,
        routing: resolvedSearch.query.routing,
        hasWorkingSet: resolvedSearch.workingSet.enabled,
      });

      const workingSetResults = searchWorkingSet({
        sessionKey: options.agentSessionKey,
        query,
        maxResults: queryPlan.maxResults,
        sourceBias: queryPlan.sourceBias,
        config: resolvedSearch.workingSet,
      });
      const persistent = await searchPersistentMemory({
        cfg,
        agentId,
        queryPlan,
        requestedMaxResults: maxResults,
        requestedMinScore: minScore,
        sessionKey: options.agentSessionKey,
      });

      const merged = mergeAndRankResults({
        resultSets: queryPlan.workingSetFirst
          ? [workingSetResults, persistent.results]
          : [persistent.results, workingSetResults],
        sourceBias: queryPlan.sourceBias,
      });

      const citationsMode = resolveMemoryCitationsMode(cfg);
      const includeCitations = shouldIncludeCitations({
        mode: citationsMode,
        sessionKey: options.agentSessionKey,
      });
      const resolved = resolveMemoryBackendConfig({ cfg, agentId });
      const decorated = decorateCitations(
        packMemorySearchResults({ results: merged, maxResults }),
        includeCitations,
      );
      const results = clampResultsByInjectedChars(
        decorated,
        resolved.qmd?.limits.maxInjectedChars,
      );
      const confidenceScore = estimateMemorySearchConfidence(results);
      const workingSetHits = results.filter((entry) => entry.source === "working-set").length;

      if (results.length > 0) {
        return jsonResult({
          results,
          provider: persistent.provider ?? (workingSetHits > 0 ? "working-set" : undefined),
          model: persistent.model,
          fallback: persistent.fallback,
          citations: citationsMode,
          mode: persistent.mode,
          plan: {
            intent: queryPlan.intent,
            strategy: queryPlan.strategy,
            sourceBias: queryPlan.sourceBias,
            queries: queryPlan.queries,
          },
          confidence: {
            score: confidenceScore,
            level: resolveConfidenceLevel(confidenceScore),
          },
          workingSet: {
            enabled: resolvedSearch.workingSet.enabled,
            hits: workingSetHits,
          },
          transientOnly: !persistent.provider && workingSetHits > 0,
          ...(persistent.error ? { warning: persistent.error } : {}),
        });
      }

      if (persistent.error) {
        return jsonResult(buildMemorySearchUnavailableResult(persistent.error));
      }

      return jsonResult({
        results: [],
        provider: persistent.provider,
        model: persistent.model,
        fallback: persistent.fallback,
        citations: citationsMode,
        mode: persistent.mode,
        plan: {
          intent: queryPlan.intent,
          strategy: queryPlan.strategy,
          sourceBias: queryPlan.sourceBias,
          queries: queryPlan.queries,
        },
        confidence: {
          score: 0,
          level: "low",
        },
        workingSet: {
          enabled: resolvedSearch.workingSet.enabled,
          hits: 0,
        },
      });
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const result = await manager.readFile({
          relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        return jsonResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

function resolveMemoryCitationsMode(cfg: OpenClawConfig): MemoryCitationsMode {
  const mode = cfg.memory?.citations;
  if (mode === "on" || mode === "off" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) {
    return results.map((entry) => ({ ...entry, citation: undefined }));
  }
  return results.map((entry) => {
    const citation = formatCitation(entry);
    const snippet = `${entry.snippet.trim()}\n\nSource: ${citation}`;
    return { ...entry, citation, snippet };
  });
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange =
    entry.startLine === entry.endLine
      ? `#L${entry.startLine}`
      : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function clampResultsByInjectedChars(
  results: MemorySearchResult[],
  budget?: number,
): MemorySearchResult[] {
  if (!budget || budget <= 0) {
    return results;
  }
  let remaining = budget;
  const clamped: MemorySearchResult[] = [];
  for (const entry of results) {
    if (remaining <= 0) {
      break;
    }
    const snippet = entry.snippet ?? "";
    if (snippet.length <= remaining) {
      clamped.push(entry);
      remaining -= snippet.length;
    } else {
      const trimmed = snippet.slice(0, Math.max(0, remaining));
      clamped.push({ ...entry, snippet: trimmed });
      break;
    }
  }
  return clamped;
}

function buildMemorySearchUnavailableResult(error: string | undefined) {
  const reason = (error ?? "memory search unavailable").trim() || "memory search unavailable";
  const isQuotaError = /insufficient_quota|quota|429/.test(reason.toLowerCase());
  const warning = isQuotaError
    ? "Memory search is unavailable because the embedding provider quota is exhausted."
    : "Memory search is unavailable due to an embedding/provider error.";
  const action = isQuotaError
    ? "Top up or switch embedding provider, then retry memory_search."
    : "Check embedding provider configuration and retry memory_search.";
  return {
    results: [],
    disabled: true,
    unavailable: true,
    error: reason,
    warning,
    action,
  };
}

function shouldIncludeCitations(params: {
  mode: MemoryCitationsMode;
  sessionKey?: string;
}): boolean {
  if (params.mode === "on") {
    return true;
  }
  if (params.mode === "off") {
    return false;
  }
  const chatType = deriveChatTypeFromSessionKey(params.sessionKey);
  return chatType === "direct";
}

function deriveChatTypeFromSessionKey(sessionKey?: string): "direct" | "group" | "channel" {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.rest) {
    return "direct";
  }
  const tokens = new Set(parsed.rest.toLowerCase().split(":").filter(Boolean));
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("group")) {
    return "group";
  }
  return "direct";
}

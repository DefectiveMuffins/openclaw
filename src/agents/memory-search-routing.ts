import { extractKeywords } from "../memory/query-expansion.js";
import type { MemorySearchResult } from "../memory/types.js";

export type MemorySearchStrategy = "auto" | "fast" | "deep";
export type MemorySearchSourceBias = "balanced" | "memory" | "sessions" | "working-set";
export type MemorySearchIntent =
  | "fact"
  | "decision"
  | "code-context"
  | "todo/status"
  | "broad-exploration";

export type MemorySearchPlan = {
  intent: MemorySearchIntent;
  strategy: Exclude<MemorySearchStrategy, "auto">;
  sourceBias: MemorySearchSourceBias;
  queries: string[];
  maxResults: number;
  minScore: number;
  workingSetFirst: boolean;
};

const CODE_CONTEXT_RE =
  /(`[^`]+`|\b[a-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|java|swift|kt|yaml|yml)\b|#L\d+|line\s+\d+|function\s+\w+|class\s+\w+)/i;
const DECISION_RE =
  /\b(decide|decision|decided|agree|agreed|approved|final|why did|why we|rationale|chosen|tradeoff)\b/i;
const TODO_STATUS_RE =
  /\b(todo|status|pending|next step|follow-?up|open item|remaining|left to do|blocked|progress)\b/i;
const BROAD_RE = /\b(compare|explore|survey|overview|architecture|design|why|how|analyze)\b/i;

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function splitQueryTerms(query: string): string[] {
  const keywords = extractKeywords(query);
  if (keywords.length > 0) {
    return uniqueQueries(keywords);
  }
  return uniqueQueries(
    query
      .toLowerCase()
      .split(/[^a-z0-9_./:-]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  );
}

export function classifyMemorySearchIntent(query: string): MemorySearchIntent {
  const cleaned = query.trim();
  if (!cleaned) {
    return "fact";
  }
  if (CODE_CONTEXT_RE.test(cleaned)) {
    return "code-context";
  }
  if (DECISION_RE.test(cleaned)) {
    return "decision";
  }
  if (TODO_STATUS_RE.test(cleaned)) {
    return "todo/status";
  }
  if (cleaned.length >= 120 || BROAD_RE.test(cleaned)) {
    return "broad-exploration";
  }
  return "fact";
}

function resolveStrategy(params: {
  query: string;
  requested: MemorySearchStrategy;
  deepQueryThreshold: number;
  intent: MemorySearchIntent;
}): Exclude<MemorySearchStrategy, "auto"> {
  if (params.requested === "fast" || params.requested === "deep") {
    return params.requested;
  }
  if (
    params.intent === "decision" ||
    params.intent === "broad-exploration" ||
    params.query.trim().length >= params.deepQueryThreshold
  ) {
    return "deep";
  }
  return "fast";
}

function resolveSourceBias(params: {
  requested?: MemorySearchSourceBias;
  intent: MemorySearchIntent;
  hasWorkingSet: boolean;
}): MemorySearchSourceBias {
  if (params.requested && params.requested !== "balanced") {
    return params.requested;
  }
  if (params.hasWorkingSet && params.intent === "code-context") {
    return "working-set";
  }
  if (params.intent === "decision" || params.intent === "todo/status") {
    return "sessions";
  }
  if (params.intent === "code-context") {
    return "memory";
  }
  return params.requested ?? "balanced";
}

function buildDeepQueries(query: string, maxQueries: number): string[] {
  const terms = splitQueryTerms(query);
  const queries = [query.trim()];
  if (terms.length > 0) {
    queries.push(terms.join(" "));
  }
  if (terms.length > 1) {
    queries.push(terms.slice(0, Math.min(4, terms.length)).join(" "));
  }
  return uniqueQueries(queries).slice(0, Math.max(1, maxQueries));
}

export function resolveMemorySearchPlan(params: {
  query: string;
  requestedStrategy?: MemorySearchStrategy;
  sourceBias?: MemorySearchSourceBias;
  maxResults: number;
  minScore: number;
  routing?: {
    enabled: boolean;
    maxQueries: number;
    deepQueryThreshold: number;
  };
  hasWorkingSet: boolean;
}): MemorySearchPlan {
  const intent = classifyMemorySearchIntent(params.query);
  const routing = params.routing ?? {
    enabled: false,
    maxQueries: 3,
    deepQueryThreshold: 80,
  };
  const requestedStrategy = params.requestedStrategy ?? "auto";
  const strategy = routing.enabled
    ? resolveStrategy({
        query: params.query,
        requested: requestedStrategy,
        deepQueryThreshold: routing.deepQueryThreshold,
        intent,
      })
    : requestedStrategy === "deep"
      ? "deep"
      : "fast";
  const sourceBias = resolveSourceBias({
    requested: params.sourceBias,
    intent,
    hasWorkingSet: params.hasWorkingSet,
  });
  const queries =
    strategy === "deep"
      ? buildDeepQueries(params.query, routing.maxQueries)
      : uniqueQueries([params.query.trim()]).slice(0, 1);
  const maxResults =
    strategy === "deep" ? Math.max(params.maxResults, Math.min(10, params.maxResults + 2)) : params.maxResults;
  const minScore = strategy === "deep" ? Math.max(0, params.minScore - 0.05) : params.minScore;
  return {
    intent,
    strategy,
    sourceBias,
    queries,
    maxResults,
    minScore,
    workingSetFirst: params.hasWorkingSet && (sourceBias === "working-set" || intent === "code-context"),
  };
}

function makeResultKey(result: MemorySearchResult): string {
  return `${result.source}:${result.path}:${result.startLine}:${result.endLine}:${result.snippet.trim()}`;
}

function mergeAdjacentResults(results: MemorySearchResult[]): MemorySearchResult[] {
  if (results.length <= 1) {
    return results;
  }
  const sorted = [...results].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source.localeCompare(b.source);
    }
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    if (a.startLine !== b.startLine) {
      return a.startLine - b.startLine;
    }
    return b.score - a.score;
  });
  const merged: MemorySearchResult[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.source === next.source &&
      last.path === next.path &&
      next.startLine <= last.endLine + 3
    ) {
      const snippets = uniqueQueries([last.snippet, next.snippet]);
      merged[merged.length - 1] = {
        ...last,
        endLine: Math.max(last.endLine, next.endLine),
        score: Math.max(last.score, next.score),
        snippet: snippets.join("\n...\n"),
      };
      continue;
    }
    merged.push(next);
  }
  return merged;
}

export function packMemorySearchResults(params: {
  results: MemorySearchResult[];
  maxResults: number;
  perPathLimit?: number;
  maxSnippetChars?: number;
}): MemorySearchResult[] {
  const deduped = new Map<string, MemorySearchResult>();
  for (const result of params.results) {
    const key = makeResultKey(result);
    const existing = deduped.get(key);
    if (!existing || result.score > existing.score) {
      deduped.set(key, result);
    }
  }
  const merged = mergeAdjacentResults([...deduped.values()]);
  const perPathLimit = params.perPathLimit ?? 2;
  const maxSnippetChars = params.maxSnippetChars ?? 1200;
  const perPathCounts = new Map<string, number>();
  const packed = merged
    .sort((a, b) => b.score - a.score)
    .filter((result) => {
      const key = `${result.source}:${result.path}`;
      const count = perPathCounts.get(key) ?? 0;
      if (count >= perPathLimit) {
        return false;
      }
      perPathCounts.set(key, count + 1);
      return true;
    })
    .slice(0, params.maxResults)
    .map((result) => ({
      ...result,
      snippet:
        result.snippet.length > maxSnippetChars
          ? `${result.snippet.slice(0, maxSnippetChars).trimEnd()}...`
          : result.snippet,
    }));
  return packed;
}

export function estimateMemorySearchConfidence(results: MemorySearchResult[]): number {
  if (results.length === 0) {
    return 0;
  }
  const top = Math.max(0, Math.min(1, results[0]?.score ?? 0));
  const support = Math.min(1, results.length / 4);
  const diversity = Math.min(1, new Set(results.map((result) => `${result.source}:${result.path}`)).size / 3);
  return Math.max(0, Math.min(1, top * 0.65 + support * 0.2 + diversity * 0.15));
}

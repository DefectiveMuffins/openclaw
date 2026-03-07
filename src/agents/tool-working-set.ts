import crypto from "node:crypto";
import { extractKeywords } from "../memory/query-expansion.js";
import type { MemorySearchResult } from "../memory/types.js";
import { extractToolResultText } from "./pi-embedded-subscribe.tools.js";
import { normalizeToolName } from "./tool-policy.js";

export type WorkingSetSource = "toolResults" | "subagentReports";

export type ToolWorkingSetConfig = {
  enabled?: boolean;
  sources?: WorkingSetSource[];
  ttlMs?: number;
  maxEntries?: number;
};

type ResolvedToolWorkingSetConfig = {
  enabled: boolean;
  sources: Set<WorkingSetSource>;
  ttlMs: number;
  maxEntries: number;
};

type WorkingSetEntry = {
  id: string;
  sessionKey: string;
  source: WorkingSetSource;
  toolName?: string;
  path?: string;
  text: string;
  createdAt: number;
  expiresAt: number;
  keywords: string[];
};

const DEFAULT_WORKING_SET_TTL_MS = 1_800_000;
const DEFAULT_WORKING_SET_MAX_ENTRIES = 200;
const DEFAULT_WORKING_SET_SOURCES: WorkingSetSource[] = ["toolResults", "subagentReports"];
const WORKING_SET = new Map<string, Map<string, WorkingSetEntry>>();
const TOOL_RESULT_ALLOWLIST = new Set([
  "read",
  "glob",
  "grep",
  "search",
  "web_fetch",
  "web_search",
  "memory_get",
]);

function resolveConfig(config?: ToolWorkingSetConfig): ResolvedToolWorkingSetConfig {
  const enabled = config?.enabled === true;
  const ttlMs =
    typeof config?.ttlMs === "number" && Number.isFinite(config.ttlMs)
      ? Math.max(1_000, Math.floor(config.ttlMs))
      : DEFAULT_WORKING_SET_TTL_MS;
  const maxEntries =
    typeof config?.maxEntries === "number" && Number.isFinite(config.maxEntries)
      ? Math.max(1, Math.floor(config.maxEntries))
      : DEFAULT_WORKING_SET_MAX_ENTRIES;
  const sources = new Set<WorkingSetSource>(
    (config?.sources?.length ? config.sources : DEFAULT_WORKING_SET_SOURCES).filter(
      (value): value is WorkingSetSource => value === "toolResults" || value === "subagentReports",
    ),
  );
  return { enabled, sources, ttlMs, maxEntries };
}

function getSessionEntries(sessionKey: string): Map<string, WorkingSetEntry> {
  let entries = WORKING_SET.get(sessionKey);
  if (!entries) {
    entries = new Map();
    WORKING_SET.set(sessionKey, entries);
  }
  return entries;
}

function purgeExpiredEntries(entries: Map<string, WorkingSetEntry>, now: number): void {
  for (const [id, entry] of entries.entries()) {
    if (entry.expiresAt <= now) {
      entries.delete(id);
    }
  }
}

function trimEntries(entries: Map<string, WorkingSetEntry>, maxEntries: number): void {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value;
    if (!oldest) {
      break;
    }
    entries.delete(oldest);
  }
}

function normalizeQueryTerms(query: string): string[] {
  return Array.from(
    new Set(
      extractKeywords(query)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length >= 2),
    ),
  );
}

function truncateText(text: string, maxChars = 2400): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}...`;
}

function resolveEntryPath(
  toolName: string | undefined,
  params: unknown,
  result: unknown,
): string | undefined {
  const paramsRecord =
    params && typeof params === "object" ? (params as Record<string, unknown>) : undefined;
  const resultRecord =
    result && typeof result === "object" ? (result as Record<string, unknown>) : undefined;
  const details =
    resultRecord?.details && typeof resultRecord.details === "object"
      ? (resultRecord.details as Record<string, unknown>)
      : undefined;
  const pathCandidate =
    (typeof details?.path === "string" && details.path) ||
    (typeof resultRecord?.path === "string" && resultRecord.path) ||
    (typeof paramsRecord?.path === "string" && paramsRecord.path) ||
    (typeof details?.url === "string" && details.url) ||
    (typeof paramsRecord?.url === "string" && paramsRecord.url);
  if (typeof pathCandidate === "string" && pathCandidate.trim()) {
    return pathCandidate.trim();
  }
  if (toolName) {
    return `working-set/${toolName}`;
  }
  return undefined;
}

function upsertEntry(params: {
  sessionKey: string;
  source: WorkingSetSource;
  text: string;
  config?: ToolWorkingSetConfig;
  toolName?: string;
  path?: string;
}): void {
  const resolved = resolveConfig(params.config);
  if (!resolved.enabled || !resolved.sources.has(params.source)) {
    return;
  }
  const now = Date.now();
  const entries = getSessionEntries(params.sessionKey);
  purgeExpiredEntries(entries, now);
  const text = truncateText(params.text);
  if (!text) {
    return;
  }
  const id = crypto
    .createHash("sha1")
    .update(`${params.source}:${params.toolName ?? ""}:${params.path ?? ""}:${text}`)
    .digest("hex");
  entries.delete(id);
  entries.set(id, {
    id,
    sessionKey: params.sessionKey,
    source: params.source,
    toolName: params.toolName,
    path: params.path,
    text,
    createdAt: now,
    expiresAt: now + resolved.ttlMs,
    keywords: normalizeQueryTerms(`${params.path ?? ""} ${text}`),
  });
  trimEntries(entries, resolved.maxEntries);
}

export function addToolResultToWorkingSet(params: {
  sessionKey?: string;
  toolName: string;
  toolParams: unknown;
  result: unknown;
  config?: ToolWorkingSetConfig;
}): void {
  if (!params.sessionKey) {
    return;
  }
  const resolved = resolveConfig(params.config);
  if (!resolved.enabled || !resolved.sources.has("toolResults")) {
    return;
  }
  const normalizedToolName = normalizeToolName(params.toolName);
  if (!TOOL_RESULT_ALLOWLIST.has(normalizedToolName)) {
    return;
  }
  const text = extractToolResultText(params.result);
  if (!text) {
    return;
  }
  upsertEntry({
    sessionKey: params.sessionKey,
    source: "toolResults",
    text,
    config: params.config,
    toolName: normalizedToolName,
    path: resolveEntryPath(normalizedToolName, params.toolParams, params.result),
  });
}

export function addSubagentReportToWorkingSet(params: {
  sessionKey?: string;
  text: string;
  config?: ToolWorkingSetConfig;
  path?: string;
  toolName?: string;
}): void {
  if (!params.sessionKey) {
    return;
  }
  upsertEntry({
    sessionKey: params.sessionKey,
    source: "subagentReports",
    text: params.text,
    config: params.config,
    toolName: params.toolName,
    path: params.path,
  });
}

export function invalidateWorkingSet(sessionKey?: string): void {
  if (!sessionKey) {
    return;
  }
  WORKING_SET.delete(sessionKey);
}

export function searchWorkingSet(params: {
  sessionKey?: string;
  query: string;
  maxResults: number;
  sourceBias?: "balanced" | "memory" | "sessions" | "working-set";
  config?: ToolWorkingSetConfig;
}): MemorySearchResult[] {
  if (!params.sessionKey) {
    return [];
  }
  const resolved = resolveConfig(params.config);
  if (!resolved.enabled) {
    return [];
  }
  const entries = WORKING_SET.get(params.sessionKey);
  if (!entries || entries.size === 0) {
    return [];
  }
  const now = Date.now();
  purgeExpiredEntries(entries, now);
  const queryTerms = normalizeQueryTerms(params.query);
  const cleanedQuery = params.query.trim().toLowerCase();
  const scored = [...entries.values()]
    .map((entry) => {
      const overlap = queryTerms.filter((term) => entry.keywords.includes(term));
      const overlapScore = queryTerms.length > 0 ? overlap.length / queryTerms.length : 0;
      const textLower = entry.text.toLowerCase();
      const fullMatchBoost = cleanedQuery && textLower.includes(cleanedQuery) ? 0.25 : 0;
      const pathBoost =
        entry.path && queryTerms.some((term) => entry.path?.toLowerCase().includes(term)) ? 0.2 : 0;
      const ageRatio = Math.max(0, Math.min(1, (entry.expiresAt - now) / resolved.ttlMs));
      const recencyBoost = ageRatio * 0.15;
      const biasBoost = params.sourceBias === "working-set" ? 0.1 : 0;
      const score = Math.max(
        0,
        Math.min(1, overlapScore * 0.6 + fullMatchBoost + pathBoost + recencyBoost + biasBoost),
      );
      return { entry, score };
    })
    .filter((candidate) => candidate.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, params.maxResults)
    .map(
      ({ entry, score }) =>
        ({
          path:
            entry.path ?? `working-set/${entry.source}/${entry.toolName ?? entry.id.slice(0, 8)}`,
          startLine: 1,
          endLine: 1,
          score,
          snippet: entry.text,
          source: "working-set" as const,
        }) satisfies MemorySearchResult,
    );
  return scored;
}

export function getWorkingSetStats(sessionKey?: string): { entries: number; active: boolean } {
  if (!sessionKey) {
    return { entries: 0, active: false };
  }
  const entries = WORKING_SET.get(sessionKey);
  return {
    entries: entries?.size ?? 0,
    active: (entries?.size ?? 0) > 0,
  };
}

export const __testing = {
  WORKING_SET,
  TOOL_RESULT_ALLOWLIST,
  normalizeQueryTerms,
  resolveEntryPath,
};

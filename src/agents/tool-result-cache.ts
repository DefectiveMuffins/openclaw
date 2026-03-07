import type { ToolResultCacheConfig } from "../config/types.tools.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { hashToolCall } from "./tool-loop-detection.js";
import { normalizeToolName } from "./tool-policy.js";

const log = createSubsystemLogger("agents/tool-result-cache");

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 100;

const DEFAULT_CACHEABLE_TOOLS = [
  "read",
  "glob",
  "grep",
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
] as const;

const MUTATING_INVALIDATION_TOOLS = new Set([
  "exec",
  "write",
  "edit",
  "apply_patch",
  "sessions_spawn",
  "sessions_send",
]);

type CacheEntry = {
  result: unknown;
  cachedAt: number;
  toolName: string;
};

type SessionToolResultCache = Map<string, CacheEntry>;

type ResolvedToolResultCacheConfig = {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  cacheableTools: Set<string>;
};

const sessionCaches = new Map<string, SessionToolResultCache>();

function asPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function cloneCacheValue<T>(value: T): T {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch {
    // Ignore and fallback.
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeToolSet(tools: readonly string[]): Set<string> {
  const normalized = new Set<string>();
  for (const name of tools) {
    const key = normalizeToolName(name);
    if (key) {
      normalized.add(key);
    }
  }
  return normalized;
}

function resolveCacheableToolSet(config?: ToolResultCacheConfig): Set<string> {
  const override = config?.cacheableTools?.filter((entry) => entry.trim().length > 0);
  if (override && override.length > 0) {
    return normalizeToolSet(override);
  }
  return normalizeToolSet(DEFAULT_CACHEABLE_TOOLS);
}

function touchCacheEntry(cache: SessionToolResultCache, key: string, value: CacheEntry): void {
  cache.delete(key);
  cache.set(key, value);
}

function trimSessionCache(cache: SessionToolResultCache, maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.delete(oldest);
  }
}

function pruneExpiredEntries(cache: SessionToolResultCache, now: number, ttlMs: number): void {
  if (cache.size === 0) {
    return;
  }
  for (const [key, entry] of cache.entries()) {
    if (now - entry.cachedAt > ttlMs) {
      cache.delete(key);
    }
  }
}

export function resolveToolResultCacheConfig(
  config?: ToolResultCacheConfig,
): ResolvedToolResultCacheConfig {
  return {
    enabled: config?.enabled === true,
    ttlMs: asPositiveInt(config?.ttlMs, DEFAULT_TTL_MS),
    maxEntries: asPositiveInt(config?.maxEntries, DEFAULT_MAX_ENTRIES),
    cacheableTools: resolveCacheableToolSet(config),
  };
}

export function isToolResultCacheInvalidationTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return MUTATING_INVALIDATION_TOOLS.has(normalized);
}

function getSessionCache(sessionKey: string): SessionToolResultCache {
  const existing = sessionCaches.get(sessionKey);
  if (existing) {
    return existing;
  }
  const created: SessionToolResultCache = new Map();
  sessionCaches.set(sessionKey, created);
  return created;
}

export function getCachedToolResult(params: {
  sessionKey?: string;
  toolName: string;
  toolParams: unknown;
  config?: ToolResultCacheConfig;
}): { hit: false } | { hit: true; result: unknown } {
  if (!params.sessionKey) {
    return { hit: false };
  }

  const config = resolveToolResultCacheConfig(params.config);
  if (!config.enabled) {
    return { hit: false };
  }

  const normalizedToolName = normalizeToolName(params.toolName);
  if (!config.cacheableTools.has(normalizedToolName)) {
    return { hit: false };
  }

  const cache = sessionCaches.get(params.sessionKey);
  if (!cache) {
    return { hit: false };
  }

  const cacheKey = hashToolCall(normalizedToolName, params.toolParams);
  const entry = cache.get(cacheKey);
  if (!entry) {
    return { hit: false };
  }

  const now = Date.now();
  if (now - entry.cachedAt > config.ttlMs) {
    cache.delete(cacheKey);
    if (cache.size === 0) {
      sessionCaches.delete(params.sessionKey);
    }
    return { hit: false };
  }

  touchCacheEntry(cache, cacheKey, entry);
  return { hit: true, result: cloneCacheValue(entry.result) };
}

export function setCachedToolResult(params: {
  sessionKey?: string;
  toolName: string;
  toolParams: unknown;
  result: unknown;
  config?: ToolResultCacheConfig;
}): void {
  if (!params.sessionKey) {
    return;
  }

  const config = resolveToolResultCacheConfig(params.config);
  if (!config.enabled) {
    return;
  }

  const normalizedToolName = normalizeToolName(params.toolName);
  if (!config.cacheableTools.has(normalizedToolName)) {
    return;
  }

  const now = Date.now();
  const cache = getSessionCache(params.sessionKey);
  pruneExpiredEntries(cache, now, config.ttlMs);

  const cacheKey = hashToolCall(normalizedToolName, params.toolParams);
  touchCacheEntry(cache, cacheKey, {
    result: cloneCacheValue(params.result),
    cachedAt: now,
    toolName: normalizedToolName,
  });
  trimSessionCache(cache, config.maxEntries);

  if (log.isEnabled("debug")) {
    log.debug(
      `tool result cache store: sessionKey=${params.sessionKey} tool=${normalizedToolName} entries=${cache.size}`,
    );
  }
}

export function invalidateToolResultCache(sessionKey?: string): void {
  if (!sessionKey) {
    return;
  }
  sessionCaches.delete(sessionKey);
}

export function resetToolResultCacheForTest(): void {
  sessionCaches.clear();
}

export const __testing = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_CACHEABLE_TOOLS,
  MUTATING_INVALIDATION_TOOLS,
  sessionCaches,
  cloneCacheValue,
};

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCachedToolResult,
  isToolResultCacheInvalidationTool,
  resetToolResultCacheForTest,
  setCachedToolResult,
} from "./tool-result-cache.js";

describe("tool-result-cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetToolResultCacheForTest();
  });

  it("returns cache hit for repeated cacheable calls within TTL", () => {
    setCachedToolResult({
      sessionKey: "main",
      toolName: "read",
      toolParams: { path: "README.md" },
      result: { text: "hello" },
      config: { enabled: true, ttlMs: 30_000, maxEntries: 100 },
    });

    const cached = getCachedToolResult({
      sessionKey: "main",
      toolName: "read",
      toolParams: { path: "README.md" },
      config: { enabled: true, ttlMs: 30_000, maxEntries: 100 },
    });

    expect(cached.hit).toBe(true);
    if (cached.hit) {
      expect(cached.result).toEqual({ text: "hello" });
    }
  });

  it("expires cache entries after TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    setCachedToolResult({
      sessionKey: "main",
      toolName: "read",
      toolParams: { path: "README.md" },
      result: { text: "hello" },
      config: { enabled: true, ttlMs: 1_000, maxEntries: 100 },
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:02Z"));

    const cached = getCachedToolResult({
      sessionKey: "main",
      toolName: "read",
      toolParams: { path: "README.md" },
      config: { enabled: true, ttlMs: 1_000, maxEntries: 100 },
    });

    expect(cached.hit).toBe(false);
  });

  it("does not cache non-cacheable tools", () => {
    setCachedToolResult({
      sessionKey: "main",
      toolName: "exec",
      toolParams: { command: "echo hello" },
      result: { text: "hello" },
      config: { enabled: true, ttlMs: 30_000, maxEntries: 100 },
    });

    const cached = getCachedToolResult({
      sessionKey: "main",
      toolName: "exec",
      toolParams: { command: "echo hello" },
      config: { enabled: true, ttlMs: 30_000, maxEntries: 100 },
    });

    expect(cached.hit).toBe(false);
  });

  it("flags mutating tools for cache invalidation", () => {
    expect(isToolResultCacheInvalidationTool("write")).toBe(true);
    expect(isToolResultCacheInvalidationTool("apply_patch")).toBe(true);
    expect(isToolResultCacheInvalidationTool("read")).toBe(false);
  });
});

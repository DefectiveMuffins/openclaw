import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveMemoryFlushPromptForRun, shouldRunMemoryFlush } from "./memory-flush.js";

describe("resolveMemoryFlushPromptForRun", () => {
  const cfg = {
    agents: {
      defaults: {
        userTimezone: "America/New_York",
        timeFormat: "12",
      },
    },
  } as OpenClawConfig;

  it("replaces YYYY-MM-DD using user timezone and appends current time", () => {
    const prompt = resolveMemoryFlushPromptForRun({
      prompt: "Store durable notes in memory/YYYY-MM-DD.md",
      cfg,
      nowMs: Date.UTC(2026, 1, 16, 15, 0, 0),
    });

    expect(prompt).toContain("memory/2026-02-16.md");
    expect(prompt).toContain("Current time:");
    expect(prompt).toContain("(America/New_York)");
  });

  it("does not append a duplicate current time line", () => {
    const prompt = resolveMemoryFlushPromptForRun({
      prompt: "Store notes.\nCurrent time: already present",
      cfg,
      nowMs: Date.UTC(2026, 1, 16, 15, 0, 0),
    });

    expect(prompt).toContain("Current time: already present");
    expect((prompt.match(/Current time:/g) ?? []).length).toBe(1);
  });
});

describe("shouldRunMemoryFlush", () => {
  it("triggers when periodic turn interval is exceeded", () => {
    const shouldFlush = shouldRunMemoryFlush({
      entry: {
        totalTokens: 100,
        totalTokensFresh: true,
        memoryFlushTurnCount: 6,
      },
      contextWindowTokens: 100_000,
      reserveTokensFloor: 1_000,
      softThresholdTokens: 4_000,
      periodicTurnInterval: 5,
      periodicMinutes: 0,
    });

    expect(shouldFlush).toBe(true);
  });

  it("does not trigger on turn interval boundary", () => {
    const shouldFlush = shouldRunMemoryFlush({
      entry: {
        totalTokens: 100,
        totalTokensFresh: true,
        memoryFlushTurnCount: 5,
      },
      contextWindowTokens: 100_000,
      reserveTokensFloor: 1_000,
      softThresholdTokens: 4_000,
      periodicTurnInterval: 5,
      periodicMinutes: 0,
    });

    expect(shouldFlush).toBe(false);
  });

  it("triggers when periodic minutes elapsed since last flush", () => {
    const nowMs = Date.UTC(2026, 1, 16, 15, 0, 0);
    const shouldFlush = shouldRunMemoryFlush({
      entry: {
        totalTokens: 100,
        totalTokensFresh: true,
        memoryFlushTurnCount: 0,
        memoryFlushAt: nowMs - 31 * 60 * 1000,
      },
      contextWindowTokens: 100_000,
      reserveTokensFloor: 1_000,
      softThresholdTokens: 4_000,
      periodicTurnInterval: 0,
      periodicMinutes: 30,
      nowMs,
    });

    expect(shouldFlush).toBe(true);
  });
});

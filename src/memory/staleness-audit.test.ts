import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditMemoryStaleness } from "./staleness-audit.js";

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("auditMemoryStaleness", () => {
  it("returns a hint when memory files are missing", async () => {
    await withTempDir("openclaw-memory-stale-empty-", async (dir) => {
      const result = await auditMemoryStaleness(dir);
      expect(result.staleHours).toBeNull();
      expect(result.hint).toMatch(/empty or missing/i);
    });
  });

  it("returns a stale hint when latest memory update is older than 48h", async () => {
    await withTempDir("openclaw-memory-stale-old-", async (dir) => {
      const memoryDir = path.join(dir, "memory");
      const dayFile = path.join(memoryDir, "2026-02-10.md");
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(dayFile, "# notes", "utf-8");
      const staleDate = new Date(Date.now() - 49 * 60 * 60 * 1000);
      await fs.utimes(dayFile, staleDate, staleDate);

      const result = await auditMemoryStaleness(dir);
      expect(result.staleHours).toBeGreaterThan(48);
      expect(result.hint).toMatch(/stale/i);
    });
  });

  it("uses the freshest file across MEMORY.md and memory/ files", async () => {
    await withTempDir("openclaw-memory-stale-fresh-", async (dir) => {
      const memoryDir = path.join(dir, "memory");
      const memoryRoot = path.join(dir, "MEMORY.md");
      const dayFile = path.join(memoryDir, "2026-02-16.md");
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.writeFile(memoryRoot, "# Memory", "utf-8");
      await fs.writeFile(dayFile, "# Day notes", "utf-8");

      const staleDate = new Date(Date.now() - 100 * 60 * 60 * 1000);
      const freshDate = new Date();
      await fs.utimes(memoryRoot, staleDate, staleDate);
      await fs.utimes(dayFile, freshDate, freshDate);

      const result = await auditMemoryStaleness(dir);
      expect(result.staleHours).toBeGreaterThanOrEqual(0);
      expect(result.staleHours).toBeLessThan(1);
      expect(result.hint).toBeUndefined();
    });
  });
});

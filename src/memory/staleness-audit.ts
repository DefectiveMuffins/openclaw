import fs from "node:fs/promises";
import path from "node:path";

const STALE_MEMORY_HOURS_THRESHOLD = 48;

async function readMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(filePath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : undefined;
  } catch {
    return undefined;
  }
}

export async function auditMemoryStaleness(
  workspaceDir: string,
): Promise<{ staleHours: number | null; hint?: string }> {
  const now = Date.now();
  const candidateMtimes: number[] = [];

  const memoryRootPath = path.join(workspaceDir, "MEMORY.md");
  const memoryRootMtime = await readMtimeMs(memoryRootPath);
  if (typeof memoryRootMtime === "number") {
    candidateMtimes.push(memoryRootMtime);
  }

  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(memoryDir, entry.name);
      const mtime = await readMtimeMs(filePath);
      if (typeof mtime === "number") {
        candidateMtimes.push(mtime);
      }
    }
  } catch {
    // Missing memory directory is handled by empty candidate list below.
  }

  if (candidateMtimes.length === 0) {
    return {
      staleHours: null,
      hint: "Memory files look empty or missing. Capture durable notes in memory/YYYY-MM-DD.md and keep MEMORY.md current.",
    };
  }

  const freshestMtime = Math.max(...candidateMtimes);
  const staleHours = Math.max(0, (now - freshestMtime) / (60 * 60 * 1000));
  if (staleHours > STALE_MEMORY_HOURS_THRESHOLD) {
    return {
      staleHours,
      hint: `Memory appears stale (${Math.floor(staleHours)}h since last update). Add fresh entries to memory/YYYY-MM-DD.md and refresh MEMORY.md/USER.md/IDENTITY.md as needed.`,
    };
  }

  return { staleHours };
}

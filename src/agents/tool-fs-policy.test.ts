import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  createToolFsPolicy,
  resolveEffectiveToolFsWorkspaceOnly,
  resolveToolFsConfig,
} from "./tool-fs-policy.js";

describe("resolveEffectiveToolFsWorkspaceOnly", () => {
  it("returns false by default when tools.fs.workspaceOnly is unset", () => {
    expect(resolveEffectiveToolFsWorkspaceOnly({ cfg: {}, agentId: "main" })).toBe(false);
  });

  it("uses global tools.fs.workspaceOnly when no agent override exists", () => {
    const cfg: OpenClawConfig = {
      tools: { fs: { workspaceOnly: true } },
    };
    expect(resolveEffectiveToolFsWorkspaceOnly({ cfg, agentId: "main" })).toBe(true);
  });

  it("prefers agent-specific tools.fs.workspaceOnly override over global setting", () => {
    const cfg: OpenClawConfig = {
      tools: { fs: { workspaceOnly: true } },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              fs: { workspaceOnly: false },
            },
          },
        ],
      },
    };
    expect(resolveEffectiveToolFsWorkspaceOnly({ cfg, agentId: "main" })).toBe(false);
  });

  it("supports agent-specific enablement when global workspaceOnly is off", () => {
    const cfg: OpenClawConfig = {
      tools: { fs: { workspaceOnly: false } },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              fs: { workspaceOnly: true },
            },
          },
        ],
      },
    };
    expect(resolveEffectiveToolFsWorkspaceOnly({ cfg, agentId: "main" })).toBe(true);
  });

  it("merges path lists with agent-level overrides", () => {
    const cfg: OpenClawConfig = {
      tools: {
        fs: {
          allowPaths: ["memory/"],
          denyPaths: ["secrets/"],
          readOnlyPaths: ["AGENTS.md"],
        },
      },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              fs: {
                allowPaths: ["memory/", "MEMORY.md"],
              },
            },
          },
        ],
      },
    };

    expect(resolveToolFsConfig({ cfg, agentId: "main" })).toEqual({
      workspaceOnly: undefined,
      allowPaths: ["memory/", "MEMORY.md"],
      denyPaths: ["secrets/"],
      readOnlyPaths: ["AGENTS.md"],
    });
  });

  it("normalizes path lists in createToolFsPolicy", () => {
    expect(
      createToolFsPolicy({
        allowPaths: ["memory/", " memory/ ", ""],
        denyPaths: ["secrets/", "secrets/"],
        readOnlyPaths: ["AGENTS.md", "  "],
      }),
    ).toEqual({
      workspaceOnly: false,
      allowPaths: ["memory/"],
      denyPaths: ["secrets/"],
      readOnlyPaths: ["AGENTS.md"],
    });
  });
});

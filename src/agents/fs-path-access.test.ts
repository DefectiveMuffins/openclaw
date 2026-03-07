import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFsAccess } from "./fs-path-access.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";

const workspaceDir = path.resolve("workspace-root-test");

function resolveInWorkspace(relativePath: string) {
  return path.resolve(workspaceDir, relativePath);
}

describe("checkFsAccess", () => {
  it("applies denyPaths before allowPaths", () => {
    const policy: ToolFsPolicy = {
      workspaceOnly: false,
      allowPaths: ["memory/"],
      denyPaths: ["memory/private/"],
    };

    expect(
      checkFsAccess(resolveInWorkspace("memory/private/secret.md"), workspaceDir, "read", policy),
    ).toEqual({
      allowed: false,
      reason: "path denied by tools.fs.denyPaths: memory/private/",
    });
  });

  it("blocks writes to readOnlyPaths but allows reads", () => {
    const policy: ToolFsPolicy = {
      workspaceOnly: false,
      readOnlyPaths: ["AGENTS.md"],
    };

    expect(checkFsAccess(resolveInWorkspace("AGENTS.md"), workspaceDir, "read", policy)).toEqual({
      allowed: true,
    });
    expect(checkFsAccess(resolveInWorkspace("AGENTS.md"), workspaceDir, "write", policy)).toEqual({
      allowed: false,
      reason: "path is read-only via tools.fs.readOnlyPaths: AGENTS.md",
    });
  });

  it("enforces allowPaths when configured", () => {
    const policy: ToolFsPolicy = {
      workspaceOnly: false,
      allowPaths: ["memory/", "MEMORY.md"],
    };

    expect(
      checkFsAccess(resolveInWorkspace("memory/today.md"), workspaceDir, "write", policy),
    ).toEqual({ allowed: true });
    expect(checkFsAccess(resolveInWorkspace("MEMORY.md"), workspaceDir, "write", policy)).toEqual({
      allowed: true,
    });
    expect(checkFsAccess(resolveInWorkspace("src/index.ts"), workspaceDir, "read", policy)).toEqual(
      {
        allowed: false,
        reason: "path is outside tools.fs.allowPaths",
      },
    );
  });
});

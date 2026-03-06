import path from "node:path";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { isPathInside } from "../infra/path-guards.js";

export type FsAccessOperation = "read" | "write";

type AccessAllowed = { allowed: true };
type AccessDenied = { allowed: false; reason: string };

function resolvePathRule(rule: string, workspaceDir: string): {
  raw: string;
  resolved: string;
  directoryLike: boolean;
} {
  const raw = rule.trim();
  const normalizedRaw = raw.replaceAll("\\", "/");
  const trimmedTrailing = normalizedRaw.replace(/\/+$/, "");
  const baseName = path.posix.basename(trimmedTrailing);
  const directoryLike = raw.endsWith("/") || raw.endsWith("\\") || !baseName.includes(".");
  const resolved = path.resolve(workspaceDir, raw);
  return { raw, resolved, directoryLike };
}

function pathMatchesRule(targetPath: string, rule: string, workspaceDir: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const resolvedRule = resolvePathRule(rule, workspaceDir);
  if (!resolvedRule.directoryLike) {
    return path.resolve(resolvedRule.resolved) === normalizedTarget;
  }
  return isPathInside(resolvedRule.resolved, normalizedTarget);
}

function findFirstMatchingRule(
  targetPath: string,
  workspaceDir: string,
  rules?: string[],
): string | undefined {
  if (!Array.isArray(rules) || rules.length === 0) {
    return undefined;
  }
  for (const rule of rules) {
    if (pathMatchesRule(targetPath, rule, workspaceDir)) {
      return rule;
    }
  }
  return undefined;
}

export function checkFsAccess(
  filePath: string,
  workspaceDir: string,
  operation: FsAccessOperation,
  policy: ToolFsPolicy,
): AccessAllowed | AccessDenied {
  const target = path.resolve(filePath);

  const deniedBy = findFirstMatchingRule(target, workspaceDir, policy.denyPaths);
  if (deniedBy) {
    return {
      allowed: false,
      reason: `path denied by tools.fs.denyPaths: ${deniedBy}`,
    };
  }

  if (operation === "write") {
    const readOnlyMatch = findFirstMatchingRule(target, workspaceDir, policy.readOnlyPaths);
    if (readOnlyMatch) {
      return {
        allowed: false,
        reason: `path is read-only via tools.fs.readOnlyPaths: ${readOnlyMatch}`,
      };
    }
  }

  const allowRules = policy.allowPaths;
  if (Array.isArray(allowRules) && allowRules.length > 0) {
    const allowedBy = findFirstMatchingRule(target, workspaceDir, allowRules);
    if (!allowedBy) {
      return {
        allowed: false,
        reason: "path is outside tools.fs.allowPaths",
      };
    }
  }

  return { allowed: true };
}

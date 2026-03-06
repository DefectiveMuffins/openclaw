import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type ToolFsPolicy = {
  workspaceOnly: boolean;
  allowPaths?: string[];
  denyPaths?: string[];
  readOnlyPaths?: string[];
};

function normalizePathList(list?: string[]): string[] | undefined {
  if (!Array.isArray(list)) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      list
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

export function createToolFsPolicy(params: {
  workspaceOnly?: boolean;
  allowPaths?: string[];
  denyPaths?: string[];
  readOnlyPaths?: string[];
}): ToolFsPolicy {
  return {
    workspaceOnly: params.workspaceOnly === true,
    allowPaths: normalizePathList(params.allowPaths),
    denyPaths: normalizePathList(params.denyPaths),
    readOnlyPaths: normalizePathList(params.readOnlyPaths),
  };
}

export function resolveToolFsConfig(params: { cfg?: OpenClawConfig; agentId?: string }): {
  workspaceOnly?: boolean;
  allowPaths?: string[];
  denyPaths?: string[];
  readOnlyPaths?: string[];
} {
  const cfg = params.cfg;
  const globalFs = cfg?.tools?.fs;
  const agentFs =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;
  return {
    workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
    allowPaths: agentFs?.allowPaths ?? globalFs?.allowPaths,
    denyPaths: agentFs?.denyPaths ?? globalFs?.denyPaths,
    readOnlyPaths: agentFs?.readOnlyPaths ?? globalFs?.readOnlyPaths,
  };
}

export function resolveEffectiveToolFsWorkspaceOnly(params: {
  cfg?: OpenClawConfig;
  agentId?: string;
}): boolean {
  return resolveToolFsConfig(params).workspaceOnly === true;
}

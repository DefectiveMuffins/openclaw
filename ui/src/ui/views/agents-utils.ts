import { html } from "lit";
import {
  listCoreToolSections,
  PROFILE_OPTIONS as TOOL_PROFILE_OPTIONS,
} from "../../../../src/agents/tool-catalog.js";
import {
  expandToolGroups,
  normalizeToolName,
  resolveToolProfilePolicy,
} from "../../../../src/agents/tool-policy-shared.js";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  GatewayModelChoice,
} from "../types.ts";

export const TOOL_SECTIONS = listCoreToolSections();

export const PROFILE_OPTIONS = TOOL_PROFILE_OPTIONS;

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

type AgentSkillsConfig = {
  promptMode?: string;
};

type AgentMemorySearchConfig = {
  enabled?: boolean;
  provider?: string;
  query?: {
    routing?: {
      enabled?: boolean;
      maxQueries?: number;
      deepQueryThreshold?: number;
    };
  };
  workingSet?: {
    enabled?: boolean;
    sources?: string[];
    ttlMs?: number;
    maxEntries?: number;
  };
};

type AgentModelRoutingConfig = {
  enabled?: boolean;
  plannerModel?: string;
  retrievalModel?: string;
  compressionModel?: string;
  verificationModel?: string;
  escalation?: {
    minConfidence?: number;
    maxCheapPasses?: number;
  };
};

type AgentSubagentDelegationConfig = {
  enabled?: boolean;
  structuredResults?: boolean;
  parallelResearch?: {
    enabled?: boolean;
    maxConcurrent?: number;
  };
};

type AgentSubagentsConfig = {
  autoTier?: boolean;
  simpleTaskModel?: string;
  delegation?: AgentSubagentDelegationConfig;
};

type AgentConfigEntry = {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: unknown;
  thinkingDefault?: string;
  skills?: string[] | AgentSkillsConfig;
  memorySearch?: AgentMemorySearchConfig;
  modelRouting?: AgentModelRoutingConfig;
  subagents?: AgentSubagentsConfig;
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

type AgentDefaultsConfig = {
  workspace?: string;
  model?: unknown;
  models?: Record<string, { alias?: string }>;
  thinkingDefault?: string;
  skills?: AgentSkillsConfig;
  memorySearch?: AgentMemorySearchConfig;
  modelRouting?: AgentModelRoutingConfig;
  subagents?: AgentSubagentsConfig;
};

type ConfigSnapshot = {
  agents?: {
    defaults?: AgentDefaultsConfig;
    list?: AgentConfigEntry[];
  };
  tools?: {
    profile?: string;
    allow?: string[];
    alsoAllow?: string[];
    deny?: string[];
  };
};

export function normalizeAgentLabel(agent: {
  id: string;
  name?: string;
  identity?: { name?: string };
}) {
  return agent.name?.trim() || agent.identity?.name?.trim() || agent.id;
}

function isLikelyEmoji(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 16) {
    return false;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return false;
  }
  if (trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return true;
}

export function resolveAgentEmoji(
  agent: { identity?: { emoji?: string; avatar?: string } },
  agentIdentity?: AgentIdentityResult | null,
) {
  const identityEmoji = agentIdentity?.emoji?.trim();
  if (identityEmoji && isLikelyEmoji(identityEmoji)) {
    return identityEmoji;
  }
  const agentEmoji = agent.identity?.emoji?.trim();
  if (agentEmoji && isLikelyEmoji(agentEmoji)) {
    return agentEmoji;
  }
  const identityAvatar = agentIdentity?.avatar?.trim();
  if (identityAvatar && isLikelyEmoji(identityAvatar)) {
    return identityAvatar;
  }
  const avatar = agent.identity?.avatar?.trim();
  if (avatar && isLikelyEmoji(avatar)) {
    return avatar;
  }
  return "";
}

export function agentBadgeText(agentId: string, defaultId: string | null) {
  return defaultId && agentId === defaultId ? "default" : null;
}

export function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) {
    return "-";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function resolveAgentConfig(config: Record<string, unknown> | null, agentId: string) {
  const cfg = config as ConfigSnapshot | null;
  const list = cfg?.agents?.list ?? [];
  const entry = list.find((agent) => agent?.id === agentId);
  return {
    entry,
    defaults: cfg?.agents?.defaults,
    globalTools: cfg?.tools,
  };
}

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

export function buildAgentContext(
  agent: AgentsListResult["agents"][number],
  configForm: Record<string, unknown> | null,
  agentFilesList: AgentsFilesListResult | null,
  defaultId: string | null,
  agentIdentity?: AgentIdentityResult | null,
): AgentContext {
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const modelLabel = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    agent.id;
  const identityEmoji = resolveAgentEmoji(agent, agentIdentity) || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  return {
    workspace,
    model: modelLabel,
    identityName,
    identityEmoji,
    skillsLabel: skillFilter ? `${skillCount} selected` : "all skills",
    isDefault: Boolean(defaultId && agent.id === defaultId),
  };
}

export function resolveModelLabel(model?: unknown): string {
  if (!model) {
    return "-";
  }
  if (typeof model === "string") {
    return model.trim() || "-";
  }
  if (typeof model === "object" && model) {
    const record = model as { primary?: string; fallbacks?: string[] };
    const primary = record.primary?.trim();
    if (primary) {
      const fallbackCount = Array.isArray(record.fallbacks) ? record.fallbacks.length : 0;
      return fallbackCount > 0 ? `${primary} (+${fallbackCount} fallback)` : primary;
    }
  }
  return "-";
}

export function normalizeModelValue(label: string): string {
  const match = label.match(/^(.+) \(\+\d+ fallback\)$/);
  return match ? match[1] : label;
}

export function resolveModelPrimary(model?: unknown): string | null {
  if (!model) {
    return null;
  }
  if (typeof model === "string") {
    const trimmed = model.trim();
    return trimmed || null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const candidate =
      typeof record.primary === "string"
        ? record.primary
        : typeof record.model === "string"
          ? record.model
          : typeof record.id === "string"
            ? record.id
            : typeof record.value === "string"
              ? record.value
              : null;
    const primary = candidate?.trim();
    return primary || null;
  }
  return null;
}

export function resolveModelFallbacks(model?: unknown): string[] | null {
  if (!model || typeof model === "string") {
    return null;
  }
  if (typeof model === "object" && model) {
    const record = model as Record<string, unknown>;
    const fallbacks = Array.isArray(record.fallbacks)
      ? record.fallbacks
      : Array.isArray(record.fallback)
        ? record.fallback
        : null;
    return fallbacks
      ? fallbacks.filter((entry): entry is string => typeof entry === "string")
      : null;
  }
  return null;
}

export function resolveEffectiveModelFallbacks(
  entryModel?: unknown,
  defaultModel?: unknown,
): string[] | null {
  return resolveModelFallbacks(entryModel) ?? resolveModelFallbacks(defaultModel);
}

export type AgentOptimizationSummary = {
  thinkingDefault: string;
  skillsPromptMode: string;
  memorySearch: {
    enabled: boolean;
    provider?: string;
    routingEnabled: boolean;
    maxQueries?: number;
    deepQueryThreshold?: number;
    workingSetEnabled: boolean;
    workingSetSources: string[];
    workingSetTtlMs?: number;
    workingSetMaxEntries?: number;
  };
  modelRouting: {
    enabled: boolean;
    plannerModel?: string;
    retrievalModel?: string;
    compressionModel?: string;
    verificationModel?: string;
    minConfidence?: number;
    maxCheapPasses?: number;
  };
  subagents: {
    autoTier: boolean;
    simpleTaskModel?: string;
    delegationEnabled: boolean;
    structuredResults: boolean;
    parallelResearchEnabled: boolean;
    parallelResearchMaxConcurrent?: number;
  };
};

function pickDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function resolveAgentOptimizationSummary(
  config: Record<string, unknown> | null,
  agentId: string,
): AgentOptimizationSummary {
  const { entry, defaults } = resolveAgentConfig(config, agentId);
  const entrySkills =
    entry?.skills && !Array.isArray(entry.skills) ? (entry.skills as AgentSkillsConfig) : undefined;
  const defaultSkills = defaults?.skills;
  const defaultMemory = defaults?.memorySearch;
  const entryMemory = entry?.memorySearch;
  const defaultModelRouting = defaults?.modelRouting;
  const entryModelRouting = entry?.modelRouting;
  const defaultSubagents = defaults?.subagents;
  const entrySubagents = entry?.subagents;
  const workingSetSources = Array.from(
    new Set([
      ...normalizeStringList(defaultMemory?.workingSet?.sources),
      ...normalizeStringList(entryMemory?.workingSet?.sources),
    ]),
  );

  return {
    thinkingDefault: pickDefined(entry?.thinkingDefault, defaults?.thinkingDefault, "off") ?? "off",
    skillsPromptMode:
      pickDefined(entrySkills?.promptMode, defaultSkills?.promptMode, "full") ?? "full",
    memorySearch: {
      enabled: Boolean(pickDefined(entryMemory?.enabled, defaultMemory?.enabled, false)),
      provider: pickDefined(entryMemory?.provider, defaultMemory?.provider),
      routingEnabled: Boolean(
        pickDefined(entryMemory?.query?.routing?.enabled, defaultMemory?.query?.routing?.enabled, false),
      ),
      maxQueries: pickDefined(
        entryMemory?.query?.routing?.maxQueries,
        defaultMemory?.query?.routing?.maxQueries,
      ),
      deepQueryThreshold: pickDefined(
        entryMemory?.query?.routing?.deepQueryThreshold,
        defaultMemory?.query?.routing?.deepQueryThreshold,
      ),
      workingSetEnabled: Boolean(
        pickDefined(entryMemory?.workingSet?.enabled, defaultMemory?.workingSet?.enabled, false),
      ),
      workingSetSources,
      workingSetTtlMs: pickDefined(entryMemory?.workingSet?.ttlMs, defaultMemory?.workingSet?.ttlMs),
      workingSetMaxEntries: pickDefined(
        entryMemory?.workingSet?.maxEntries,
        defaultMemory?.workingSet?.maxEntries,
      ),
    },
    modelRouting: {
      enabled: Boolean(
        pickDefined(entryModelRouting?.enabled, defaultModelRouting?.enabled, false),
      ),
      plannerModel: pickDefined(entryModelRouting?.plannerModel, defaultModelRouting?.plannerModel),
      retrievalModel: pickDefined(
        entryModelRouting?.retrievalModel,
        defaultModelRouting?.retrievalModel,
      ),
      compressionModel: pickDefined(
        entryModelRouting?.compressionModel,
        defaultModelRouting?.compressionModel,
      ),
      verificationModel: pickDefined(
        entryModelRouting?.verificationModel,
        defaultModelRouting?.verificationModel,
      ),
      minConfidence: pickDefined(
        entryModelRouting?.escalation?.minConfidence,
        defaultModelRouting?.escalation?.minConfidence,
      ),
      maxCheapPasses: pickDefined(
        entryModelRouting?.escalation?.maxCheapPasses,
        defaultModelRouting?.escalation?.maxCheapPasses,
      ),
    },
    subagents: {
      autoTier: Boolean(pickDefined(entrySubagents?.autoTier, defaultSubagents?.autoTier, false)),
      simpleTaskModel: pickDefined(
        entrySubagents?.simpleTaskModel,
        defaultSubagents?.simpleTaskModel,
      ),
      delegationEnabled: Boolean(
        pickDefined(
          entrySubagents?.delegation?.enabled,
          defaultSubagents?.delegation?.enabled,
          false,
        ),
      ),
      structuredResults: Boolean(
        pickDefined(
          entrySubagents?.delegation?.structuredResults,
          defaultSubagents?.delegation?.structuredResults,
          false,
        ),
      ),
      parallelResearchEnabled: Boolean(
        pickDefined(
          entrySubagents?.delegation?.parallelResearch?.enabled,
          defaultSubagents?.delegation?.parallelResearch?.enabled,
          false,
        ),
      ),
      parallelResearchMaxConcurrent: pickDefined(
        entrySubagents?.delegation?.parallelResearch?.maxConcurrent,
        defaultSubagents?.delegation?.parallelResearch?.maxConcurrent,
      ),
    },
  };
}

function addModelId(target: Set<string>, value: unknown) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  target.add(trimmed);
}

function addModelConfigIds(target: Set<string>, modelConfig: unknown) {
  if (!modelConfig) {
    return;
  }
  if (typeof modelConfig === "string") {
    addModelId(target, modelConfig);
    return;
  }
  if (typeof modelConfig !== "object") {
    return;
  }
  const record = modelConfig as Record<string, unknown>;
  addModelId(target, record.primary);
  addModelId(target, record.model);
  addModelId(target, record.id);
  addModelId(target, record.value);
  const fallbacks = Array.isArray(record.fallbacks)
    ? record.fallbacks
    : Array.isArray(record.fallback)
      ? record.fallback
      : [];
  for (const fallback of fallbacks) {
    addModelId(target, fallback);
  }
}

export function resolveConfiguredCronModelSuggestions(
  configForm: Record<string, unknown> | null,
): string[] {
  if (!configForm || typeof configForm !== "object") {
    return [];
  }
  const agents = (configForm as { agents?: unknown }).agents;
  if (!agents || typeof agents !== "object") {
    return [];
  }
  const out = new Set<string>();
  const defaults = (agents as { defaults?: unknown }).defaults;
  if (defaults && typeof defaults === "object") {
    const defaultsRecord = defaults as Record<string, unknown>;
    addModelConfigIds(out, defaultsRecord.model);
    const defaultsModels = defaultsRecord.models;
    if (defaultsModels && typeof defaultsModels === "object") {
      for (const modelId of Object.keys(defaultsModels as Record<string, unknown>)) {
        addModelId(out, modelId);
      }
    }
  }
  const list = (agents as { list?: unknown }).list;
  if (list && typeof list === "object") {
    for (const entry of Object.values(list as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      addModelConfigIds(out, (entry as Record<string, unknown>).model);
    }
  }
  return [...out].toSorted((a, b) => a.localeCompare(b));
}

export function parseFallbackList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

type ConfiguredModelOption = {
  value: string;
  label: string;
};

function resolveConfiguredModels(
  configForm: Record<string, unknown> | null,
): ConfiguredModelOption[] {
  const cfg = configForm as ConfigSnapshot | null;
  const models = cfg?.agents?.defaults?.models;
  if (!models || typeof models !== "object") {
    return [];
  }
  const options: ConfiguredModelOption[] = [];
  for (const [modelId, modelRaw] of Object.entries(models)) {
    const trimmed = modelId.trim();
    if (!trimmed) {
      continue;
    }
    const alias =
      modelRaw && typeof modelRaw === "object" && "alias" in modelRaw
        ? typeof (modelRaw as { alias?: unknown }).alias === "string"
          ? (modelRaw as { alias?: string }).alias?.trim()
          : undefined
        : undefined;
    const label = alias && alias !== trimmed ? `${alias} (${trimmed})` : trimmed;
    options.push({ value: trimmed, label });
  }
  return options;
}

function buildCatalogModelOptions(modelChoices: GatewayModelChoice[]): ConfiguredModelOption[] {
  return modelChoices.flatMap((entry) => {
    const provider = entry.provider?.trim();
    const id = entry.id?.trim();
    if (!provider || !id) {
      return [];
    }
    const value = `${provider}/${id}`;
    const name = entry.name?.trim();
    return [{ value, label: name && name !== id ? `${name} (${value})` : value }];
  });
}

export function buildModelOptions(
  configForm: Record<string, unknown> | null,
  current?: string | null,
  modelChoices: GatewayModelChoice[] = [],
) {
  const options = resolveConfiguredModels(configForm);
  const seen = new Set(options.map((option) => option.value));
  for (const option of buildCatalogModelOptions(modelChoices)) {
    if (seen.has(option.value)) {
      continue;
    }
    options.push(option);
    seen.add(option.value);
  }
  const hasCurrent = current ? seen.has(current) : false;
  if (current && !hasCurrent) {
    options.unshift({ value: current, label: `Current (${current})` });
  }
  if (options.length === 0) {
    return html`
      <option value="" disabled>No available models</option>
    `;
  }
  return options.map((option) => html`<option value=${option.value}>${option.label}</option>`);
}

type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

function compilePattern(pattern: string): CompiledPattern {
  const normalized = normalizeToolName(pattern);
  if (!normalized) {
    return { kind: "exact", value: "" };
  }
  if (normalized === "*") {
    return { kind: "all" };
  }
  if (!normalized.includes("*")) {
    return { kind: "exact", value: normalized };
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return { kind: "regex", value: new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`) };
}

function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return expandToolGroups(patterns)
    .map(compilePattern)
    .filter((pattern) => {
      return pattern.kind !== "exact" || pattern.value.length > 0;
    });
}

function matchesAny(name: string, patterns: CompiledPattern[]) {
  for (const pattern of patterns) {
    if (pattern.kind === "all") {
      return true;
    }
    if (pattern.kind === "exact" && name === pattern.value) {
      return true;
    }
    if (pattern.kind === "regex" && pattern.value.test(name)) {
      return true;
    }
  }
  return false;
}

export function isAllowedByPolicy(name: string, policy?: ToolPolicy) {
  if (!policy) {
    return true;
  }
  const normalized = normalizeToolName(name);
  const deny = compilePatterns(policy.deny);
  if (matchesAny(normalized, deny)) {
    return false;
  }
  const allow = compilePatterns(policy.allow);
  if (allow.length === 0) {
    return true;
  }
  if (matchesAny(normalized, allow)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", allow)) {
    return true;
  }
  return false;
}

export function matchesList(name: string, list?: string[]) {
  if (!Array.isArray(list) || list.length === 0) {
    return false;
  }
  const normalized = normalizeToolName(name);
  const patterns = compilePatterns(list);
  if (matchesAny(normalized, patterns)) {
    return true;
  }
  if (normalized === "apply_patch" && matchesAny("exec", patterns)) {
    return true;
  }
  return false;
}

export function resolveToolProfile(profile: string) {
  return resolveToolProfilePolicy(profile) ?? undefined;
}


import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import {
  auditSkillEntries,
  loadWorkspaceSkillEntries,
  setSkillTrustDecision,
  type SkillEntry,
} from "../../agents/skills.js";
import { listAgentWorkspaceDirs } from "../../agents/workspace-dirs.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsAuditParams,
  validateSkillsBinsParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsTrustParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function resolveRequestedAgent(params: { agentId?: string }, cfg: OpenClawConfig) {
  const agentIdRaw = typeof params.agentId === "string" ? params.agentId.trim() : "";
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : resolveDefaultAgentId(cfg);
  if (agentIdRaw) {
    const knownAgents = listAgentIds(cfg);
    if (!knownAgents.includes(agentId)) {
      throw new Error(`unknown agent id "${agentIdRaw}"`);
    }
  }
  return { agentId, agentIdRaw };
}

function resolveSkillKey(entry: SkillEntry): string {
  return entry.metadata?.skillKey ?? entry.skill.name;
}

function findSkillEntry(entries: SkillEntry[], skillKey: string): SkillEntry | undefined {
  const normalized = skillKey.trim();
  return entries.find(
    (entry) => entry.skill.name === normalized || resolveSkillKey(entry) === normalized,
  );
}

function formatSkillsInvalidRequest(
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
) {
  return errorShape(
    ErrorCodes.INVALID_REQUEST,
    `invalid ${method} params: ${formatValidationErrors(errors)}`,
  );
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toSkillAuditPayload(result: Awaited<ReturnType<typeof auditSkillEntries>>[number]) {
  return {
    name: result.entry.skill.name,
    skillKey: resolveSkillKey(result.entry),
    source: result.entry.skill.source,
    bundled: result.entry.skill.source === "openclaw-bundled",
    filePath: result.entry.skill.filePath,
    baseDir: result.entry.skill.baseDir,
    quarantined: result.audit.quarantined,
    auditStatus: result.audit.auditStatus,
    auditSummary: result.audit.auditSummary,
    lastScannedAt: result.audit.lastScannedAt,
    trustReason: result.audit.trustReason,
    findings: result.findings,
  };
}

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": ({ params, respond }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.status", validateSkillsStatusParams.errors),
      );
      return;
    }
    const cfg = loadConfig();
    let workspaceDir = "";
    try {
      const { agentId } = resolveRequestedAgent(params ?? {}, cfg);
      workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, toErrorMessage(err)));
      return;
    }
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: { remote: getRemoteSkillEligibility() },
    });
    respond(true, report, undefined);
  },
  "skills.audit": ({ params, respond }) => {
    if (!validateSkillsAuditParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.audit", validateSkillsAuditParams.errors),
      );
      return;
    }
    const cfg = loadConfig();
    let workspaceDir = "";
    try {
      const { agentId } = resolveRequestedAgent(params ?? {}, cfg);
      workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, toErrorMessage(err)));
      return;
    }
    const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
    const skillKey = typeof params?.skillKey === "string" ? params.skillKey.trim() : "";
    const selected = skillKey ? findSkillEntry(entries, skillKey) : undefined;
    if (skillKey && !selected) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown skill "${skillKey}"`),
      );
      return;
    }
    const results = auditSkillEntries(selected ? [selected] : entries, { forceRescan: true });
    respond(
      true,
      {
        workspaceDir,
        skills: results.map((result) => toSkillAuditPayload(result)),
      },
      undefined,
    );
  },
  "skills.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.bins", validateSkillsBinsParams.errors),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listAgentWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.install", validateSkillsInstallParams.errors),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      timeoutMs?: number;
    };
    const cfg = loadConfig();
    const workspaceDirRaw = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.trust": ({ params, respond }) => {
    if (!validateSkillsTrustParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.trust", validateSkillsTrustParams.errors),
      );
      return;
    }
    const cfg = loadConfig();
    let workspaceDir = "";
    try {
      const { agentId } = resolveRequestedAgent(params ?? {}, cfg);
      workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, toErrorMessage(err)));
      return;
    }

    const p = params as { skillKey: string; action: "approve" | "revoke" };
    const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
    const entry = findSkillEntry(entries, p.skillKey);
    if (!entry) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown skill "${p.skillKey}"`),
      );
      return;
    }
    const audit = setSkillTrustDecision({ entry, action: p.action });
    respond(
      true,
      {
        ok: true,
        skillKey: resolveSkillKey(entry),
        action: p.action,
        quarantined: audit.quarantined,
        auditStatus: audit.auditStatus,
        auditSummary: audit.auditSummary,
        lastScannedAt: audit.lastScannedAt,
        trustReason: audit.trustReason,
      },
      undefined,
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        formatSkillsInvalidRequest("skills.update", validateSkillsUpdateParams.errors),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = normalizeSecretInput(p.apiKey);
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: OpenClawConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
};

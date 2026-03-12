import type { Skill } from "@mariozechner/pi-coding-agent";
import type { SkillScanSeverity } from "../../security/skill-scanner.js";

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type OpenClawSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillCommandDispatchSpec = {
  kind: "tool";
  /** Name of the tool to invoke (AnyAgentTool.name). */
  toolName: string;
  /**
   * How to forward user-provided args to the tool.
   * - raw: forward the raw args string (no core parsing).
   */
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  /** Optional deterministic dispatch behavior for this command. */
  dispatch?: SkillCommandDispatchSpec;
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

export type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: OpenClawSkillMetadata;
  invocation?: SkillInvocationPolicy;
  audit?: SkillAuditState;
};

export type SkillAuditStatus =
  | "not_applicable"
  | "pending"
  | "clean"
  | "warn"
  | "critical"
  | "scan_failed";

export type SkillTrustReason =
  | "bundled"
  | "plugin_owned"
  | "approved"
  | "new"
  | "changed"
  | "upgrade_existing"
  | "upgrade_warn"
  | "critical_findings"
  | "scan_failed"
  | "unreviewed";

export type SkillAuditPreviewFinding = {
  ruleId: string;
  severity: SkillScanSeverity;
  file: string;
  line: number;
  message: string;
};

export type SkillAuditSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findingsPreview: SkillAuditPreviewFinding[];
};

export type SkillAuditState = {
  canonicalDir?: string;
  fingerprint?: string;
  approvedFingerprint?: string;
  approved: boolean;
  quarantined: boolean;
  auditStatus: SkillAuditStatus;
  auditSummary?: SkillAuditSummary;
  lastScannedAt?: number;
  trustReason: SkillTrustReason;
};

export type SkillEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
};

export type SkillSnapshot = {
  prompt: string;
  compactPrompt?: string;
  skills: Array<{ name: string; primaryEnv?: string; requiredEnv?: string[] }>;
  /** Normalized agent-level filter used to build this snapshot; undefined means unrestricted. */
  skillFilter?: string[];
  resolvedSkills?: Skill[];
  version?: number;
};

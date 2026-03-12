import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import {
  listScannableFilesSync,
  scanDirectoryWithSummarySync,
  type SkillScanFinding,
  type SkillScanSummary,
} from "../../security/skill-scanner.js";
import type {
  SkillAuditPreviewFinding,
  SkillAuditState,
  SkillAuditStatus,
  SkillAuditSummary,
  SkillEntry,
  SkillTrustReason,
} from "./types.js";

const SKILL_TRUST_STORE_VERSION = 1 as const;
const FINDINGS_PREVIEW_LIMIT = 5;
const FINGERPRINT_INLINE_FILE_BYTES = 1024 * 1024;

type PersistedSkillTrustRecord = {
  canonicalDir: string;
  currentFingerprint?: string;
  approvedFingerprint?: string;
  auditStatus?: Exclude<SkillAuditStatus, "not_applicable">;
  auditSummary?: SkillAuditSummary;
  lastScannedAt?: number;
  trustReason?: Exclude<SkillTrustReason, "bundled" | "plugin_owned">;
};

type PersistedSkillTrustStore = {
  version: typeof SKILL_TRUST_STORE_VERSION;
  migrationComplete?: boolean;
  baselineAt: number;
  records: Record<string, PersistedSkillTrustRecord>;
};

export type SkillAuditResult = {
  entry: SkillEntry;
  audit: SkillAuditState;
  findings: SkillScanFinding[];
};

function resolveSkillTrustStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "skills", "trust.json");
}

function recordsEqual(
  left: PersistedSkillTrustRecord | undefined,
  right: PersistedSkillTrustRecord | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function loadSkillTrustStore(): PersistedSkillTrustStore {
  const storePath = resolveSkillTrustStorePath();
  const raw = loadJsonFile(resolveSkillTrustStorePath());
  if (!raw || typeof raw !== "object") {
    const store: PersistedSkillTrustStore = {
      version: SKILL_TRUST_STORE_VERSION,
      migrationComplete: false,
      baselineAt: Date.now(),
      records: {},
    };
    saveJsonFile(storePath, store);
    return store;
  }
  const typed = raw as Partial<PersistedSkillTrustStore>;
  if (typed.version !== SKILL_TRUST_STORE_VERSION || !typed.records) {
    const store: PersistedSkillTrustStore = {
      version: SKILL_TRUST_STORE_VERSION,
      migrationComplete: false,
      baselineAt: Date.now(),
      records: {},
    };
    saveJsonFile(storePath, store);
    return store;
  }
  const store: PersistedSkillTrustStore = {
    version: SKILL_TRUST_STORE_VERSION,
    migrationComplete: typed.migrationComplete === true,
    baselineAt: typeof typed.baselineAt === "number" ? typed.baselineAt : Date.now(),
    records: typed.records,
  };
  if (typeof typed.baselineAt !== "number") {
    saveJsonFile(storePath, store);
  }
  return store;
}

function saveSkillTrustStore(store: PersistedSkillTrustStore): void {
  saveJsonFile(resolveSkillTrustStorePath(), store);
}

export function resetSkillTrustStoreForTest(): void {
  try {
    fs.rmSync(resolveSkillTrustStorePath(), { force: true });
  } catch {
    // ignore
  }
}

function isBundledSkill(entry: SkillEntry): boolean {
  return entry.skill.source === "openclaw-bundled";
}

function isPluginOwnedSkill(entry: SkillEntry): boolean {
  return entry.skill.source === "openclaw-plugin";
}

export function isThirdPartyStandaloneSkill(entry: SkillEntry): boolean {
  return !isBundledSkill(entry) && !isPluginOwnedSkill(entry);
}

function resolveCanonicalSkillDir(baseDir: string): string {
  try {
    return fs.realpathSync.native(baseDir);
  } catch {
    return path.resolve(baseDir);
  }
}

function toPreviewFinding(rootDir: string, finding: SkillScanFinding): SkillAuditPreviewFinding {
  const relative = path.relative(rootDir, finding.file);
  const file =
    relative && relative !== "." && !relative.startsWith("..")
      ? relative
      : path.basename(finding.file);
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    file: file.replaceAll("\\", "/"),
    line: finding.line,
    message: finding.message,
  };
}

function summarizeAudit(rootDir: string, summary: SkillScanSummary): SkillAuditSummary {
  return {
    scannedFiles: summary.scannedFiles,
    critical: summary.critical,
    warn: summary.warn,
    info: summary.info,
    findingsPreview: summary.findings
      .slice(0, FINDINGS_PREVIEW_LIMIT)
      .map((finding) => toPreviewFinding(rootDir, finding)),
  };
}

function resolveAuditStatus(
  summary: SkillScanSummary,
): Exclude<SkillAuditStatus, "not_applicable"> {
  if (summary.critical > 0) {
    return "critical";
  }
  if (summary.warn > 0) {
    return "warn";
  }
  return "clean";
}

function buildNotApplicableAudit(reason: "bundled" | "plugin_owned"): SkillAuditState {
  return {
    approved: true,
    quarantined: false,
    auditStatus: "not_applicable",
    trustReason: reason,
  };
}

function buildPendingAudit(): SkillAuditState {
  return {
    approved: false,
    quarantined: false,
    auditStatus: "pending",
    trustReason: "unreviewed",
  };
}

function resolveSkillLastModified(canonicalDir: string): number {
  const files = listScannableFilesSync(canonicalDir);
  let latest = 0;
  for (const filePath of files) {
    try {
      latest = Math.max(latest, fs.statSync(filePath).mtimeMs);
    } catch {
      // ignore deleted/racy files
    }
  }
  if (latest > 0) {
    return latest;
  }
  try {
    return fs.statSync(canonicalDir).mtimeMs;
  } catch {
    return Date.now();
  }
}

function computeSkillFingerprint(canonicalDir: string): string {
  const files = listScannableFilesSync(canonicalDir);
  const hash = crypto.createHash("sha256");
  for (const filePath of files.toSorted()) {
    const relative = path.relative(canonicalDir, filePath).replaceAll("\\", "/");
    hash.update(relative);
    hash.update("\0");
    const st = fs.statSync(filePath);
    hash.update(String(st.size));
    hash.update("\0");
    if (st.size <= FINGERPRINT_INLINE_FILE_BYTES) {
      hash.update(fs.readFileSync(filePath));
    } else {
      const buffer = fs.readFileSync(filePath, { encoding: "utf8", flag: "r" }).slice(0, 8192);
      hash.update(buffer);
      hash.update("\0");
      hash.update(String(st.mtimeMs));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function evaluateEntryAudit(params: {
  entry: SkillEntry;
  record?: PersistedSkillTrustRecord;
  migrationBaselineAt: number;
  forceRescan?: boolean;
}): { audit: SkillAuditState; record?: PersistedSkillTrustRecord; findings: SkillScanFinding[] } {
  const { entry, forceRescan } = params;
  if (isBundledSkill(entry)) {
    return { audit: buildNotApplicableAudit("bundled"), findings: [] };
  }
  if (isPluginOwnedSkill(entry)) {
    return { audit: buildNotApplicableAudit("plugin_owned"), findings: [] };
  }

  const canonicalDir = resolveCanonicalSkillDir(entry.skill.baseDir);
  let record: PersistedSkillTrustRecord = params.record
    ? { ...params.record, canonicalDir }
    : { canonicalDir };
  const fingerprint = computeSkillFingerprint(canonicalDir);
  const firstSeen = !params.record;
  const existedBeforeBaseline =
    firstSeen && resolveSkillLastModified(canonicalDir) <= params.migrationBaselineAt;
  const changed = Boolean(record.currentFingerprint && record.currentFingerprint !== fingerprint);
  const needsScan =
    forceRescan === true ||
    !record.auditStatus ||
    record.currentFingerprint !== fingerprint ||
    !record.auditSummary ||
    typeof record.lastScannedAt !== "number";

  let findings: SkillScanFinding[] = [];
  let auditStatus: Exclude<SkillAuditStatus, "not_applicable">;
  let auditSummary: SkillAuditSummary | undefined;
  let lastScannedAt = record.lastScannedAt;

  if (needsScan) {
    try {
      const summary = scanDirectoryWithSummarySync(canonicalDir);
      findings = summary.findings;
      auditStatus = resolveAuditStatus(summary);
      auditSummary = summarizeAudit(canonicalDir, summary);
      lastScannedAt = Date.now();
    } catch {
      auditStatus = "scan_failed";
      auditSummary = {
        scannedFiles: 0,
        critical: 0,
        warn: 0,
        info: 0,
        findingsPreview: [],
      };
      lastScannedAt = Date.now();
    }
  } else {
    auditStatus = record.auditStatus ?? "pending";
    auditSummary = record.auditSummary;
  }

  if (firstSeen && existedBeforeBaseline) {
    if (auditStatus === "critical") {
      record.approvedFingerprint = undefined;
      record.trustReason = "critical_findings";
    } else if (auditStatus === "scan_failed") {
      record.approvedFingerprint = undefined;
      record.trustReason = "scan_failed";
    } else {
      record.approvedFingerprint = fingerprint;
      record.trustReason = auditStatus === "warn" ? "upgrade_warn" : "upgrade_existing";
    }
  } else if (auditStatus === "critical") {
    record.trustReason = "critical_findings";
  } else if (auditStatus === "scan_failed") {
    record.trustReason = "scan_failed";
  } else if (record.approvedFingerprint === fingerprint) {
    record.trustReason = "approved";
  } else if (changed) {
    record.trustReason = "changed";
  } else if (firstSeen) {
    record.trustReason = "new";
  } else {
    record.trustReason = record.trustReason ?? "unreviewed";
  }

  record = {
    ...record,
    canonicalDir,
    currentFingerprint: fingerprint,
    auditStatus,
    auditSummary,
    lastScannedAt,
  };

  const approved = Boolean(
    record.approvedFingerprint && record.approvedFingerprint === fingerprint,
  );
  const audit: SkillAuditState = {
    canonicalDir,
    fingerprint,
    approvedFingerprint: record.approvedFingerprint,
    approved,
    quarantined: !approved,
    auditStatus,
    auditSummary,
    lastScannedAt,
    trustReason: record.trustReason ?? "unreviewed",
  };

  return { audit, record, findings };
}

export function applySkillAuditState(entries: SkillEntry[]): SkillEntry[] {
  const store = loadSkillTrustStore();
  if (entries.length === 0) {
    return entries;
  }
  const nextEntries = entries.map((entry) => ({ ...entry }));
  let storeChanged = false;

  for (const entry of nextEntries) {
    if (!isThirdPartyStandaloneSkill(entry)) {
      entry.audit = isBundledSkill(entry)
        ? buildNotApplicableAudit("bundled")
        : buildNotApplicableAudit("plugin_owned");
      continue;
    }

    const canonicalDir = resolveCanonicalSkillDir(entry.skill.baseDir);
    const { audit, record } = evaluateEntryAudit({
      entry,
      record: store.records[canonicalDir],
      migrationBaselineAt: store.baselineAt,
    });
    entry.audit = audit;
    if (record && !recordsEqual(store.records[canonicalDir], record)) {
      store.records[canonicalDir] = record;
      storeChanged = true;
    }
  }

  if (storeChanged) {
    saveSkillTrustStore(store);
  }

  return nextEntries;
}

export function auditSkillEntries(
  entries: SkillEntry[],
  opts?: { forceRescan?: boolean },
): SkillAuditResult[] {
  const store = loadSkillTrustStore();
  if (entries.length === 0) {
    return [];
  }
  let storeChanged = false;
  const results: SkillAuditResult[] = [];

  for (const sourceEntry of entries) {
    const entry = { ...sourceEntry };
    if (!isThirdPartyStandaloneSkill(entry)) {
      const audit = isBundledSkill(entry)
        ? buildNotApplicableAudit("bundled")
        : buildNotApplicableAudit("plugin_owned");
      entry.audit = audit;
      results.push({ entry, audit, findings: [] });
      continue;
    }

    const canonicalDir = resolveCanonicalSkillDir(entry.skill.baseDir);
    const { audit, record, findings } = evaluateEntryAudit({
      entry,
      record: store.records[canonicalDir],
      migrationBaselineAt: store.baselineAt,
      forceRescan: opts?.forceRescan,
    });
    entry.audit = audit;
    if (record && !recordsEqual(store.records[canonicalDir], record)) {
      store.records[canonicalDir] = record;
      storeChanged = true;
    }
    results.push({ entry, audit, findings });
  }

  if (storeChanged) {
    saveSkillTrustStore(store);
  }

  return results;
}

export function setSkillTrustDecision(params: {
  entry: SkillEntry;
  action: "approve" | "revoke";
}): SkillAuditState {
  const entry = params.entry;
  if (!isThirdPartyStandaloneSkill(entry)) {
    return isBundledSkill(entry)
      ? buildNotApplicableAudit("bundled")
      : buildNotApplicableAudit("plugin_owned");
  }

  const store = loadSkillTrustStore();
  const canonicalDir = resolveCanonicalSkillDir(entry.skill.baseDir);
  const { audit, record } = evaluateEntryAudit({
    entry,
    record: store.records[canonicalDir],
    migrationBaselineAt: store.baselineAt,
    forceRescan: false,
  });
  if (!record || !audit.fingerprint) {
    return audit;
  }

  if (params.action === "approve") {
    record.approvedFingerprint = audit.fingerprint;
    record.trustReason = "approved";
  } else {
    record.approvedFingerprint = undefined;
    record.trustReason = "unreviewed";
  }
  store.records[canonicalDir] = record;
  saveSkillTrustStore(store);

  return {
    ...audit,
    approvedFingerprint: record.approvedFingerprint,
    approved: params.action === "approve",
    quarantined: params.action !== "approve",
    trustReason: record.trustReason,
  };
}

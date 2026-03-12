import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { hasErrnoCode } from "../infra/errors.js";
import { isPathInside } from "./scan-paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillScanSeverity = "info" | "warn" | "critical";

export type SkillScanFinding = {
  ruleId: string;
  severity: SkillScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type SkillScanSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: SkillScanFinding[];
};

export type SkillScanOptions = {
  includeFiles?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
};

// ---------------------------------------------------------------------------
// Scannable files
// ---------------------------------------------------------------------------

const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
]);

const SCANNABLE_BASENAMES = new Set(["skill.md"]);

const DEFAULT_MAX_SCAN_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const FILE_SCAN_CACHE_MAX = 5000;
const DIR_ENTRY_CACHE_MAX = 5000;
const SHEBANG_READ_BYTES = 256;

type FileScanCacheEntry = {
  size: number;
  mtimeMs: number;
  maxFileBytes: number;
  scanned: boolean;
  findings: SkillScanFinding[];
};

const FILE_SCAN_CACHE = new Map<string, FileScanCacheEntry>();

type CachedDirEntry = {
  name: string;
  kind: "file" | "dir";
};

type DirEntryCacheEntry = {
  mtimeMs: number;
  entries: CachedDirEntry[];
};

const DIR_ENTRY_CACHE = new Map<string, DirEntryCacheEntry>();

export function isScannable(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (SCANNABLE_BASENAMES.has(base)) {
    return true;
  }
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function looksLikeScriptHeader(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#!")) {
    return true;
  }
  return /^(@echo off|set -e|set -eu|set -euo pipefail|#!\/)/im.test(text);
}

async function readFilePrefix(filePath: string, bytes = SHEBANG_READ_BYTES): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, read.bytesRead).toString("utf8");
  } finally {
    await handle.close().catch(() => {});
  }
}

function readFilePrefixSync(filePath: string, bytes = SHEBANG_READ_BYTES): string {
  const fd = fsSync.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fsSync.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fsSync.closeSync(fd);
  }
}

async function isScannablePath(filePath: string): Promise<boolean> {
  if (isScannable(filePath)) {
    return true;
  }
  if (path.extname(filePath)) {
    return false;
  }
  try {
    return looksLikeScriptHeader(await readFilePrefix(filePath));
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return false;
    }
    throw err;
  }
}

export function isScannablePathSync(filePath: string): boolean {
  if (isScannable(filePath)) {
    return true;
  }
  if (path.extname(filePath)) {
    return false;
  }
  try {
    return looksLikeScriptHeader(readFilePrefixSync(filePath));
  } catch {
    return false;
  }
}

function getCachedFileScanResult(params: {
  filePath: string;
  size: number;
  mtimeMs: number;
  maxFileBytes: number;
}): FileScanCacheEntry | undefined {
  const cached = FILE_SCAN_CACHE.get(params.filePath);
  if (!cached) {
    return undefined;
  }
  if (
    cached.size !== params.size ||
    cached.mtimeMs !== params.mtimeMs ||
    cached.maxFileBytes !== params.maxFileBytes
  ) {
    FILE_SCAN_CACHE.delete(params.filePath);
    return undefined;
  }
  return cached;
}

function setCachedFileScanResult(filePath: string, entry: FileScanCacheEntry): void {
  if (FILE_SCAN_CACHE.size >= FILE_SCAN_CACHE_MAX) {
    const oldest = FILE_SCAN_CACHE.keys().next();
    if (!oldest.done) {
      FILE_SCAN_CACHE.delete(oldest.value);
    }
  }
  FILE_SCAN_CACHE.set(filePath, entry);
}

function setCachedDirEntries(dirPath: string, entry: DirEntryCacheEntry): void {
  if (DIR_ENTRY_CACHE.size >= DIR_ENTRY_CACHE_MAX) {
    const oldest = DIR_ENTRY_CACHE.keys().next();
    if (!oldest.done) {
      DIR_ENTRY_CACHE.delete(oldest.value);
    }
  }
  DIR_ENTRY_CACHE.set(dirPath, entry);
}

export function clearSkillScanCacheForTest(): void {
  FILE_SCAN_CACHE.clear();
  DIR_ENTRY_CACHE.clear();
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

type LineRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

type SourceRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
  requiresContext?: RegExp;
};

const LINE_RULES: LineRule[] = [
  {
    ruleId: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
  },
  {
    ruleId: "python-process-execution",
    severity: "critical",
    message: "Process execution detected (Python)",
    pattern:
      /\b(?:subprocess\.(?:run|Popen|call|check_call|check_output)|os\.(?:system|popen)|pty\.spawn)\s*\(/,
  },
  {
    ruleId: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    ruleId: "python-dynamic-code",
    severity: "critical",
    message: "Dynamic code execution detected (Python)",
    pattern: /\bexec\s*\(/,
  },
  {
    ruleId: "shell-download-and-run",
    severity: "critical",
    message: "Download-and-run shell pattern detected",
    pattern:
      /\b(?:curl|wget)\b[^\n|]{0,240}\|\s*(?:bash|sh|zsh)\b|\bInvoke-WebRequest\b[^\n|]{0,240}\|\s*(?:iex|Invoke-Expression)\b/i,
  },
  {
    ruleId: "encoded-command",
    severity: "critical",
    message: "Encoded or decoded payload execution detected",
    pattern:
      /-(?:EncodedCommand|enc)\b|\b(?:base64|openssl)\b[^\n|]{0,240}(?:-d|--decode)[^\n|]{0,240}\|\s*(?:bash|sh|zsh|python|node)\b|\bxxd\s+-r\s+-p\b[^\n|]{0,240}\|\s*(?:bash|sh|zsh|python|node)\b/i,
  },
  {
    ruleId: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
  {
    ruleId: "suspicious-network",
    severity: "warn",
    message: "WebSocket connection to non-standard port",
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
  },
  {
    ruleId: "shell-env-exfiltration",
    severity: "critical",
    message: "Shell environment export combined with network send",
    pattern:
      /\b(?:env|printenv)\b[^\n|]{0,120}\|\s*(?:curl|wget)\b|\b(?:curl|wget)\b[^\n]*\$(?:[A-Z_]{2,}|AWS_[A-Z_]+|OPENAI_API_KEY|ANTHROPIC_API_KEY)\b/,
  },
];

const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);

const NETWORK_SEND_PATTERN =
  /\bfetch\b|\bpost\b|http\.request|https\.request|requests\.(?:post|put)|httpx\.(?:post|put)|urllib\.request\b|curl\b|wget\b/i;

const SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "potential-exfiltration",
    severity: "warn",
    message: "File read combined with network send - possible data exfiltration",
    pattern: /readFileSync|readFile|\bopen\s*\(|Path\([^)]*\)\.(?:read_text|read_bytes)\s*\(/,
    requiresContext: NETWORK_SEND_PATTERN,
  },
  {
    ruleId: "markdown-dangerous-instructions",
    severity: "warn",
    message: "SKILL instructions include download-and-run guidance",
    pattern:
      /(?:^|\n)\s*(?:```[^\n]*\n)?[^\n]*(?:curl|wget|Invoke-WebRequest)[^\n|]{0,240}\|\s*(?:bash|sh|zsh|iex|Invoke-Expression)\b/im,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Hex-encoded string sequence detected (possible obfuscation)",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    pattern:
      /(?:atob|Buffer\.from|base64\s+-d|base64\s+--decode)\s*\(?\s*["']?[A-Za-z0-9+/=]{200,}/,
  },
  {
    ruleId: "env-harvesting",
    severity: "critical",
    message:
      "Environment variable access combined with network send - possible credential harvesting",
    pattern: /process\.env|\bos\.(?:environ|getenv)\b|dotenv_values\s*\(/,
    requiresContext: NETWORK_SEND_PATTERN,
  },
];

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

function truncateEvidence(evidence: string, maxLen = 120): string {
  if (evidence.length <= maxLen) {
    return evidence;
  }
  return `${evidence.slice(0, maxLen)}...`;
}

export function scanSource(source: string, filePath: string): SkillScanFinding[] {
  const findings: SkillScanFinding[] = [];
  const lines = source.split("\n");
  const matchedLineRules = new Set<string>();

  for (const rule of LINE_RULES) {
    if (matchedLineRules.has(rule.ruleId)) {
      continue;
    }
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue;
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const match = rule.pattern.exec(line);
      if (!match) {
        continue;
      }

      if (rule.ruleId === "suspicious-network") {
        const port = Number.parseInt(match[1] ?? "", 10);
        if (STANDARD_PORTS.has(port)) {
          continue;
        }
      }

      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: filePath,
        line: i + 1,
        message: rule.message,
        evidence: truncateEvidence(line.trim()),
      });
      matchedLineRules.add(rule.ruleId);
      break;
    }
  }

  const matchedSourceRules = new Set<string>();
  for (const rule of SOURCE_RULES) {
    const ruleKey = `${rule.ruleId}::${rule.message}`;
    if (matchedSourceRules.has(ruleKey)) {
      continue;
    }
    if (!rule.pattern.test(source)) {
      continue;
    }
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue;
    }

    let matchLine = 0;
    let matchEvidence = "";
    for (let i = 0; i < lines.length; i += 1) {
      if (rule.pattern.test(lines[i] ?? "")) {
        matchLine = i + 1;
        matchEvidence = (lines[i] ?? "").trim();
        break;
      }
    }
    if (matchLine === 0) {
      matchLine = 1;
      matchEvidence = source.slice(0, 120);
    }

    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file: filePath,
      line: matchLine,
      message: rule.message,
      evidence: truncateEvidence(matchEvidence),
    });
    matchedSourceRules.add(ruleKey);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

function normalizeScanOptions(opts?: SkillScanOptions): Required<SkillScanOptions> {
  return {
    includeFiles: opts?.includeFiles ?? [],
    maxFiles: Math.max(1, opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES),
    maxFileBytes: Math.max(1, opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
  };
}

async function readDirEntriesWithCache(dirPath: string): Promise<CachedDirEntry[]> {
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    st = await fs.stat(dirPath);
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return [];
    }
    throw err;
  }
  if (!st?.isDirectory()) {
    return [];
  }

  const cached = DIR_ENTRY_CACHE.get(dirPath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.entries;
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries: CachedDirEntry[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: "dir" });
    } else if (entry.isFile()) {
      entries.push({ name: entry.name, kind: "file" });
    }
  }
  setCachedDirEntries(dirPath, { mtimeMs: st.mtimeMs, entries });
  return entries;
}

function readDirEntriesWithCacheSync(dirPath: string): CachedDirEntry[] {
  let st: fsSync.Stats | null = null;
  try {
    st = fsSync.statSync(dirPath);
  } catch {
    return [];
  }
  if (!st.isDirectory()) {
    return [];
  }

  const cached = DIR_ENTRY_CACHE.get(dirPath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.entries;
  }

  const dirents = fsSync.readdirSync(dirPath, { withFileTypes: true });
  const entries: CachedDirEntry[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: "dir" });
    } else if (entry.isFile()) {
      entries.push({ name: entry.name, kind: "file" });
    }
  }
  setCachedDirEntries(dirPath, { mtimeMs: st.mtimeMs, entries });
  return entries;
}

async function walkDirWithLimit(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop();
    if (!currentDir) {
      break;
    }
    const entries = await readDirEntriesWithCache(currentDir);
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.kind === "dir") {
        stack.push(fullPath);
        continue;
      }
      if (entry.kind === "file" && (await isScannablePath(fullPath))) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function walkDirWithLimitSync(dirPath: string, maxFiles: number): string[] {
  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop();
    if (!currentDir) {
      break;
    }
    const entries = readDirEntriesWithCacheSync(currentDir);
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.kind === "dir") {
        stack.push(fullPath);
        continue;
      }
      if (entry.kind === "file" && isScannablePathSync(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function resolveForcedFiles(params: {
  rootDir: string;
  includeFiles: string[];
}): Promise<string[]> {
  if (params.includeFiles.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawIncludePath of params.includeFiles) {
    const includePath = path.resolve(params.rootDir, rawIncludePath);
    if (!isPathInside(params.rootDir, includePath)) {
      continue;
    }
    if (!(await isScannablePath(includePath))) {
      continue;
    }
    if (seen.has(includePath)) {
      continue;
    }

    let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      st = await fs.stat(includePath);
    } catch (err) {
      if (hasErrnoCode(err, "ENOENT")) {
        continue;
      }
      throw err;
    }
    if (!st?.isFile()) {
      continue;
    }

    out.push(includePath);
    seen.add(includePath);
  }

  return out;
}

function resolveForcedFilesSync(params: { rootDir: string; includeFiles: string[] }): string[] {
  if (params.includeFiles.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawIncludePath of params.includeFiles) {
    const includePath = path.resolve(params.rootDir, rawIncludePath);
    if (!isPathInside(params.rootDir, includePath)) {
      continue;
    }
    if (!isScannablePathSync(includePath)) {
      continue;
    }
    if (seen.has(includePath)) {
      continue;
    }

    let st: fsSync.Stats | null = null;
    try {
      st = fsSync.statSync(includePath);
    } catch {
      continue;
    }
    if (!st.isFile()) {
      continue;
    }

    out.push(includePath);
    seen.add(includePath);
  }

  return out;
}

async function collectScannableFiles(
  dirPath: string,
  opts: Required<SkillScanOptions>,
): Promise<string[]> {
  const forcedFiles = await resolveForcedFiles({
    rootDir: dirPath,
    includeFiles: opts.includeFiles,
  });
  if (forcedFiles.length >= opts.maxFiles) {
    return forcedFiles.slice(0, opts.maxFiles);
  }

  const walkedFiles = await walkDirWithLimit(dirPath, opts.maxFiles);
  const seen = new Set(forcedFiles.map((filePath) => path.resolve(filePath)));
  const out = [...forcedFiles];
  for (const walkedFile of walkedFiles) {
    if (out.length >= opts.maxFiles) {
      break;
    }
    const resolved = path.resolve(walkedFile);
    if (seen.has(resolved)) {
      continue;
    }
    out.push(walkedFile);
    seen.add(resolved);
  }
  return out;
}

export function listScannableFilesSync(dirPath: string, opts?: SkillScanOptions): string[] {
  const scanOptions = normalizeScanOptions(opts);
  const forcedFiles = resolveForcedFilesSync({
    rootDir: dirPath,
    includeFiles: scanOptions.includeFiles,
  });
  if (forcedFiles.length >= scanOptions.maxFiles) {
    return forcedFiles.slice(0, scanOptions.maxFiles);
  }

  const walkedFiles = walkDirWithLimitSync(dirPath, scanOptions.maxFiles);
  const seen = new Set(forcedFiles.map((filePath) => path.resolve(filePath)));
  const out = [...forcedFiles];
  for (const walkedFile of walkedFiles) {
    if (out.length >= scanOptions.maxFiles) {
      break;
    }
    const resolved = path.resolve(walkedFile);
    if (seen.has(resolved)) {
      continue;
    }
    out.push(walkedFile);
    seen.add(resolved);
  }
  return out;
}

async function scanFileWithCache(params: {
  filePath: string;
  maxFileBytes: number;
}): Promise<{ scanned: boolean; findings: SkillScanFinding[] }> {
  const { filePath, maxFileBytes } = params;
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    st = await fs.stat(filePath);
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return { scanned: false, findings: [] };
    }
    throw err;
  }
  if (!st?.isFile()) {
    return { scanned: false, findings: [] };
  }

  const cached = getCachedFileScanResult({
    filePath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    maxFileBytes,
  });
  if (cached) {
    return { scanned: cached.scanned, findings: cached.findings };
  }

  if (st.size > maxFileBytes) {
    const skippedEntry: FileScanCacheEntry = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      maxFileBytes,
      scanned: false,
      findings: [],
    };
    setCachedFileScanResult(filePath, skippedEntry);
    return { scanned: false, findings: [] };
  }

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return { scanned: false, findings: [] };
    }
    throw err;
  }

  const findings = scanSource(source, filePath);
  setCachedFileScanResult(filePath, {
    size: st.size,
    mtimeMs: st.mtimeMs,
    maxFileBytes,
    scanned: true,
    findings,
  });
  return { scanned: true, findings };
}

function scanFileWithCacheSync(params: { filePath: string; maxFileBytes: number }): {
  scanned: boolean;
  findings: SkillScanFinding[];
} {
  const { filePath, maxFileBytes } = params;
  let st: fsSync.Stats | null = null;
  try {
    st = fsSync.statSync(filePath);
  } catch {
    return { scanned: false, findings: [] };
  }
  if (!st.isFile()) {
    return { scanned: false, findings: [] };
  }

  const cached = getCachedFileScanResult({
    filePath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    maxFileBytes,
  });
  if (cached) {
    return { scanned: cached.scanned, findings: cached.findings };
  }

  if (st.size > maxFileBytes) {
    const skippedEntry: FileScanCacheEntry = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      maxFileBytes,
      scanned: false,
      findings: [],
    };
    setCachedFileScanResult(filePath, skippedEntry);
    return { scanned: false, findings: [] };
  }

  const source = fsSync.readFileSync(filePath, "utf8");
  const findings = scanSource(source, filePath);
  setCachedFileScanResult(filePath, {
    size: st.size,
    mtimeMs: st.mtimeMs,
    maxFileBytes,
    scanned: true,
    findings,
  });
  return { scanned: true, findings };
}

function summarizeScanResults(
  files: string[],
  scanner: (filePath: string) => { scanned: boolean; findings: SkillScanFinding[] },
): SkillScanSummary {
  const allFindings: SkillScanFinding[] = [];
  let scannedFiles = 0;
  let critical = 0;
  let warn = 0;
  let info = 0;

  for (const file of files) {
    const scanResult = scanner(file);
    if (!scanResult.scanned) {
      continue;
    }
    scannedFiles += 1;
    for (const finding of scanResult.findings) {
      allFindings.push(finding);
      if (finding.severity === "critical") {
        critical += 1;
      } else if (finding.severity === "warn") {
        warn += 1;
      } else {
        info += 1;
      }
    }
  }

  return {
    scannedFiles,
    critical,
    warn,
    info,
    findings: allFindings,
  };
}

export async function scanDirectory(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanFinding[]> {
  const scanOptions = normalizeScanOptions(opts);
  const files = await collectScannableFiles(dirPath, scanOptions);
  const summary = summarizeScanResults(files, (filePath) =>
    // `summarizeScanResults` is sync; the async path preloads per-file sequentially.
    fsSync.existsSync(filePath)
      ? scanFileWithCacheSync({ filePath, maxFileBytes: scanOptions.maxFileBytes })
      : { scanned: false, findings: [] },
  );
  return summary.findings;
}

export async function scanDirectoryWithSummary(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanSummary> {
  const scanOptions = normalizeScanOptions(opts);
  const files = await collectScannableFiles(dirPath, scanOptions);
  const allFindings: SkillScanFinding[] = [];
  let scannedFiles = 0;
  let critical = 0;
  let warn = 0;
  let info = 0;

  for (const file of files) {
    const scanResult = await scanFileWithCache({
      filePath: file,
      maxFileBytes: scanOptions.maxFileBytes,
    });
    if (!scanResult.scanned) {
      continue;
    }
    scannedFiles += 1;
    for (const finding of scanResult.findings) {
      allFindings.push(finding);
      if (finding.severity === "critical") {
        critical += 1;
      } else if (finding.severity === "warn") {
        warn += 1;
      } else {
        info += 1;
      }
    }
  }

  return { scannedFiles, critical, warn, info, findings: allFindings };
}

export function scanDirectorySync(dirPath: string, opts?: SkillScanOptions): SkillScanFinding[] {
  const summary = scanDirectoryWithSummarySync(dirPath, opts);
  return summary.findings;
}

export function scanDirectoryWithSummarySync(
  dirPath: string,
  opts?: SkillScanOptions,
): SkillScanSummary {
  const scanOptions = normalizeScanOptions(opts);
  const files = listScannableFilesSync(dirPath, scanOptions);
  return summarizeScanResults(files, (filePath) =>
    scanFileWithCacheSync({ filePath, maxFileBytes: scanOptions.maxFileBytes }),
  );
}

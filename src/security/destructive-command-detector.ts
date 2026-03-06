type DestructivePattern = {
  id: string;
  regex: RegExp;
};

// Centralized destructive command signatures for exec pre-dispatch checks.
// These are intentionally conservative and focus on well-known destructive primitives.
export const DESTRUCTIVE_COMMAND_PATTERNS: readonly DestructivePattern[] = [
  {
    id: "rm-recursive",
    regex: /\brm\b[^\r\n;|&]*(?:--recursive|\s-[^\s\r\n;|&]*r[^\s\r\n;|&]*)/i,
  },
  {
    id: "rmdir",
    regex: /\brmdir\b/i,
  },
  {
    id: "mkfs",
    regex: /\bmkfs(?:\.[a-z0-9_-]+)?\b/i,
  },
  {
    id: "dd-of-root",
    regex: /\bdd\b[^\r\n;|&]*\bof\s*=\s*\/\S*/i,
  },
  {
    id: "shred",
    regex: /\bshred\b/i,
  },
  {
    id: "git-clean-force",
    regex: /\bgit\b[^\r\n;|&]*\bclean\b[^\r\n;|&]*(?:--force|\s-[^\s\r\n;|&]*f[^\s\r\n;|&]*)/i,
  },
  {
    id: "git-reset-hard",
    regex: /\bgit\b[^\r\n;|&]*\breset\b[^\r\n;|&]*--hard\b/i,
  },
  {
    id: "chmod-recursive-system",
    regex:
      /\bchmod\b[^\r\n;|&]*(?:--recursive|\s-[^\s\r\n;|&]*r[^\s\r\n;|&]*)[^\r\n;|&]*\s\/(?:$|bin\b|boot\b|dev\b|etc\b|lib\b|lib64\b|proc\b|root\b|sbin\b|sys\b|usr\b|var\b)/i,
  },
  {
    id: "format-command",
    regex: /(?:^|[;&|]\s*)format(?:\.com)?\b/i,
  },
  {
    id: "truncate-redirect-absolute",
    regex: /(?:^|[;&|]\s*)[^#\r\n]*?(?:\s|^)(?:>|1>|>\|)\s*\/\S*/i,
  },
] as const;

export function isDestructiveCommand(
  command: string,
): { destructive: boolean; pattern?: string } {
  const raw = command.trim();
  if (!raw) {
    return { destructive: false };
  }

  for (const entry of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (!entry.regex.test(raw)) {
      continue;
    }
    return { destructive: true, pattern: entry.id };
  }
  return { destructive: false };
}

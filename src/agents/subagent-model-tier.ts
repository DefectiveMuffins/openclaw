export type SubagentTaskComplexity = "simple" | "complex";

const SIMPLE_TASK_KEYWORDS = [
  "read",
  "list",
  "format",
  "summarize",
  "summary",
  "check",
  "find",
  "count",
  "fetch",
] as const;

const COMPLEX_TASK_KEYWORDS = [
  "implement",
  "refactor",
  "debug",
  "architect",
  "architecture",
  "design",
  "fix",
  "optimize",
  "optimization",
  "analyze",
] as const;

function hasKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

/**
 * Conservative task complexity classifier for subagent model tiering.
 * Defaults to "complex" unless the task is clearly low-complexity.
 */
export function classifyTaskComplexity(taskDescription: string): SubagentTaskComplexity {
  const normalized = taskDescription.trim().toLowerCase();
  if (!normalized) {
    return "complex";
  }

  if (hasKeyword(normalized, COMPLEX_TASK_KEYWORDS)) {
    return "complex";
  }

  if (hasKeyword(normalized, SIMPLE_TASK_KEYWORDS)) {
    return "simple";
  }

  return "complex";
}

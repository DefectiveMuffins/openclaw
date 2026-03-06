export const SUBAGENT_DELEGATION_ROLES = ["research", "edit", "verify", "summarize"] as const;
export type SubagentDelegationRole = (typeof SUBAGENT_DELEGATION_ROLES)[number];

export const SUBAGENT_RESPONSE_FORMATS = ["text", "structured"] as const;
export type SubagentResponseFormat = (typeof SUBAGENT_RESPONSE_FORMATS)[number];

export type StructuredSubagentResult = {
  summary: string;
  evidence: string[];
  uncertainties: string[];
  confidence: number;
  recommendedNextStep?: string;
};

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (entry && typeof entry === "object") {
        const candidate =
          (entry as { text?: unknown; claim?: unknown; detail?: unknown }).text ??
          (entry as { text?: unknown; claim?: unknown; detail?: unknown }).claim ??
          (entry as { text?: unknown; claim?: unknown; detail?: unknown }).detail;
        return typeof candidate === "string" ? candidate.trim() : "";
      }
      return "";
    })
    .filter((entry): entry is string => Boolean(entry));
}

function extractJsonCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const match = trimmed.match(JSON_BLOCK_RE);
  return match?.[1]?.trim();
}

export function parseStructuredSubagentResult(text: string): StructuredSubagentResult | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate) as {
      summary?: unknown;
      evidence?: unknown;
      uncertainties?: unknown;
      confidence?: unknown;
      recommendedNextStep?: unknown;
    };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) {
      return null;
    }
    const evidence = normalizeStringList(parsed.evidence);
    const uncertainties = normalizeStringList(parsed.uncertainties);
    let confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? parsed.confidence
        : 0;
    if (confidence > 1 && confidence <= 100) {
      confidence /= 100;
    }
    confidence = Math.max(0, Math.min(1, confidence));
    const recommendedNextStep =
      typeof parsed.recommendedNextStep === "string" && parsed.recommendedNextStep.trim()
        ? parsed.recommendedNextStep.trim()
        : undefined;
    return {
      summary,
      evidence,
      uncertainties,
      confidence,
      recommendedNextStep,
    };
  } catch {
    return null;
  }
}

export function buildDelegationContractPromptLines(params: {
  role?: SubagentDelegationRole;
  deliverable?: string;
  acceptance?: string[];
  responseFormat?: SubagentResponseFormat;
}): string[] {
  const lines: string[] = [];
  const acceptance = (params.acceptance ?? []).map((entry) => entry.trim()).filter(Boolean);
  const hasContract =
    Boolean(params.role) ||
    Boolean(params.deliverable?.trim()) ||
    acceptance.length > 0 ||
    params.responseFormat === "structured";
  if (!hasContract) {
    return lines;
  }

  lines.push("## Delegation Contract");
  if (params.role) {
    lines.push(`- Role: ${params.role}`);
  }
  if (params.deliverable?.trim()) {
    lines.push(`- Deliverable: ${params.deliverable.trim()}`);
  }
  if (acceptance.length > 0) {
    lines.push("- Acceptance criteria:");
    for (const item of acceptance) {
      lines.push(`  - ${item}`);
    }
  }
  if (params.responseFormat === "structured") {
    lines.push("- Response format: return ONLY a JSON object with this shape:");
    lines.push("```json");
    lines.push("{");
    lines.push('  "summary": "short result summary",');
    lines.push('  "evidence": ["key supporting fact or citation"],');
    lines.push('  "uncertainties": ["open question or residual risk"],');
    lines.push('  "confidence": 0.0,');
    lines.push('  "recommendedNextStep": "optional next action"');
    lines.push("}");
    lines.push("```");
    lines.push("- Keep `confidence` between 0 and 1.");
  }
  lines.push("");
  return lines;
}

export function getSubagentReportWorkingSetText(text: string): string {
  const parsed = parseStructuredSubagentResult(text);
  if (!parsed) {
    return text.trim();
  }
  const lines = [
    `Summary: ${parsed.summary}`,
    ...(parsed.evidence.length > 0
      ? parsed.evidence.map((entry, index) => `Evidence ${index + 1}: ${entry}`)
      : []),
    ...(parsed.uncertainties.length > 0
      ? parsed.uncertainties.map((entry, index) => `Uncertainty ${index + 1}: ${entry}`)
      : []),
    `Confidence: ${parsed.confidence}`,
    ...(parsed.recommendedNextStep ? [`Recommended next step: ${parsed.recommendedNextStep}`] : []),
  ];
  return lines.join("\n");
}

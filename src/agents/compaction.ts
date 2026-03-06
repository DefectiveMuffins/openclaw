import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { estimateTokens, generateSummary } from "@mariozechner/pi-coding-agent";
import type { AgentCompactionIdentifierPolicy } from "../config/types.agent-defaults.js";
import { retryAsync } from "../infra/retry.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";
import { repairToolUseResultPairing, stripToolResultDetails } from "./session-transcript-repair.js";

const log = createSubsystemLogger("compaction");

export const BASE_CHUNK_RATIO = 0.4;
export const MIN_CHUNK_RATIO = 0.15;
export const SAFETY_MARGIN = 1.2; // 20% buffer for estimateTokens() inaccuracy
const DEFAULT_SUMMARY_FALLBACK = "No prior history.";
const DEFAULT_PARTS = 2;
const MERGE_SUMMARIES_INSTRUCTIONS =
  "Merge these partial summaries into a single cohesive summary. Preserve decisions," +
  " TODOs, open questions, and any constraints.";
const IDENTIFIER_PRESERVATION_INSTRUCTIONS =
  "Preserve all opaque identifiers exactly as written (no shortening or reconstruction), " +
  "including UUIDs, hashes, IDs, tokens, API keys, hostnames, IPs, ports, URLs, and file names.";
const DEFAULT_RELEVANCE_IDENTIFIER_WINDOW = 12;
const MAX_IDENTIFIER_SOURCE_CHARS = 2_000;
const MAX_IDENTIFIERS_PER_MESSAGE = 128;
const MAX_RECENT_IDENTIFIERS = 512;
const FUNCTION_IDENTIFIER_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]{2,}(?=\s*\()/g;
const SCOPED_IDENTIFIER_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]*(?:(?:\.|::)[A-Za-z_][A-Za-z0-9_]*)+\b/g;
const BACKTICK_IDENTIFIER_PATTERN = /`([^`\n]+)`/g;
const STOP_IDENTIFIER_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "that",
  "this",
  "then",
  "when",
  "where",
  "which",
  "what",
  "into",
  "need",
  "make",
  "open",
  "read",
  "write",
  "edit",
  "file",
  "files",
  "tool",
  "tools",
  "message",
  "messages",
  "user",
  "assistant",
  "result",
  "error",
  "true",
  "false",
  "null",
  "undefined",
]);

export type CompactionSummarizationInstructions = {
  identifierPolicy?: AgentCompactionIdentifierPolicy;
  identifierInstructions?: string;
};

function resolveIdentifierPreservationInstructions(
  instructions?: CompactionSummarizationInstructions,
): string | undefined {
  const policy = instructions?.identifierPolicy ?? "strict";
  if (policy === "off") {
    return undefined;
  }
  if (policy === "custom") {
    const custom = instructions?.identifierInstructions?.trim();
    return custom && custom.length > 0 ? custom : IDENTIFIER_PRESERVATION_INSTRUCTIONS;
  }
  return IDENTIFIER_PRESERVATION_INSTRUCTIONS;
}

export function buildCompactionSummarizationInstructions(
  customInstructions?: string,
  instructions?: CompactionSummarizationInstructions,
): string | undefined {
  const custom = customInstructions?.trim();
  const identifierPreservation = resolveIdentifierPreservationInstructions(instructions);
  if (!identifierPreservation && !custom) {
    return undefined;
  }
  if (!custom) {
    return identifierPreservation;
  }
  if (!identifierPreservation) {
    return `Additional focus:\n${custom}`;
  }
  return `${identifierPreservation}\n\nAdditional focus:\n${custom}`;
}

export function estimateMessagesTokens(messages: AgentMessage[]): number {
  // SECURITY: toolResult.details can contain untrusted/verbose payloads; never include in LLM-facing compaction.
  const safe = stripToolResultDetails(messages);
  return safe.reduce((sum, message) => sum + estimateTokens(message), 0);
}

function normalizeIdentifier(raw: string): string | null {
  const trimmed = raw.trim().replace(/^[^\w/\\.:]+|[^\w/\\.:]+$/g, "");
  if (trimmed.length < 3) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (STOP_IDENTIFIER_WORDS.has(lowered)) {
    return null;
  }
  return lowered;
}

function pushIdentifier(set: Set<string>, value: string): void {
  if (set.size >= MAX_IDENTIFIERS_PER_MESSAGE) {
    return;
  }
  const normalized = normalizeIdentifier(value);
  if (!normalized) {
    return;
  }
  set.add(normalized);
}

function collectMessageTextSegments(message: AgentMessage): string[] {
  const segments: string[] = [];
  const msgRecord = message as unknown as Record<string, unknown>;
  const fields: unknown[] = [
    msgRecord.content,
    msgRecord.toolName,
    msgRecord.toolCallId,
    msgRecord.tool_name,
    msgRecord.tool_call_id,
  ];

  for (const field of fields) {
    if (typeof field === "string") {
      segments.push(field);
      continue;
    }
    if (!Array.isArray(field)) {
      continue;
    }
    for (const block of field) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const typed = block as {
        type?: unknown;
        text?: unknown;
        thinking?: unknown;
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof typed.text === "string") {
        segments.push(typed.text);
      }
      if (typeof typed.thinking === "string") {
        segments.push(typed.thinking);
      }
      if (typed.type === "toolCall" && typeof typed.name === "string") {
        segments.push(typed.name);
      }
      if (typed.type === "toolCall" && typed.arguments !== undefined) {
        try {
          const serialized = JSON.stringify(typed.arguments);
          if (serialized) {
            segments.push(serialized);
          }
        } catch {
          // Ignore unserializable tool-call arguments for relevance scoring.
        }
      }
    }
  }

  return segments;
}

function addIdentifiersFromText(text: string, identifiers: Set<string>): void {
  const limited = text.slice(0, MAX_IDENTIFIER_SOURCE_CHARS);
  for (const raw of limited.matchAll(FUNCTION_IDENTIFIER_PATTERN)) {
    if (raw[0]) {
      pushIdentifier(identifiers, raw[0]);
    }
  }
  for (const raw of limited.matchAll(SCOPED_IDENTIFIER_PATTERN)) {
    if (raw[0]) {
      pushIdentifier(identifiers, raw[0]);
    }
  }
  for (const match of limited.matchAll(BACKTICK_IDENTIFIER_PATTERN)) {
    const value = match[1];
    if (!value) {
      continue;
    }
    for (const token of value.split(/\s+/)) {
      if (!token) {
        continue;
      }
      pushIdentifier(identifiers, token);
    }
  }
  for (const rawToken of limited.split(/\s+/)) {
    if (!rawToken) {
      continue;
    }
    if (!rawToken.includes("/") && !rawToken.includes("\\")) {
      continue;
    }
    pushIdentifier(identifiers, rawToken);
  }
}

function extractMessageIdentifiers(message: AgentMessage): Set<string> {
  const identifiers = new Set<string>();
  for (const segment of collectMessageTextSegments(message)) {
    if (identifiers.size >= MAX_IDENTIFIERS_PER_MESSAGE) {
      break;
    }
    addIdentifiersFromText(segment, identifiers);
  }
  return identifiers;
}

export function collectRecentIdentifiers(
  messages: AgentMessage[],
  windowSize?: number,
): Set<string> {
  const window = Math.max(1, Math.floor(windowSize ?? DEFAULT_RELEVANCE_IDENTIFIER_WINDOW));
  const start = Math.max(0, messages.length - window);
  const recent = new Set<string>();
  for (let i = start; i < messages.length; i += 1) {
    for (const identifier of extractMessageIdentifiers(messages[i])) {
      recent.add(identifier);
      if (recent.size >= MAX_RECENT_IDENTIFIERS) {
        return recent;
      }
    }
  }
  return recent;
}

export function scoreMessageRelevance(
  message: AgentMessage,
  recentIdentifiers: ReadonlySet<string>,
): number {
  if (recentIdentifiers.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const identifier of extractMessageIdentifiers(message)) {
    if (recentIdentifiers.has(identifier)) {
      overlap += 1;
    }
  }
  return overlap;
}

function scoreChunkRelevance(
  chunk: AgentMessage[],
  recentIdentifiers: ReadonlySet<string>,
): number {
  return chunk.reduce((sum, message) => sum + scoreMessageRelevance(message, recentIdentifiers), 0);
}

function resolveDropChunkIndex(params: {
  chunks: AgentMessage[][];
  pruningStrategy: "recency" | "relevance";
  recentIdentifiers: ReadonlySet<string>;
}): number {
  if (params.pruningStrategy !== "relevance" || params.recentIdentifiers.size === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < params.chunks.length; i += 1) {
    const score = scoreChunkRelevance(params.chunks[i], params.recentIdentifiers);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function estimateCompactionMessageTokens(message: AgentMessage): number {
  return estimateMessagesTokens([message]);
}

function normalizeParts(parts: number, messageCount: number): number {
  if (!Number.isFinite(parts) || parts <= 1) {
    return 1;
  }
  return Math.min(Math.max(1, Math.floor(parts)), Math.max(1, messageCount));
}

export function splitMessagesByTokenShare(
  messages: AgentMessage[],
  parts = DEFAULT_PARTS,
): AgentMessage[][] {
  if (messages.length === 0) {
    return [];
  }
  const normalizedParts = normalizeParts(parts, messages.length);
  if (normalizedParts <= 1) {
    return [messages];
  }

  const totalTokens = estimateMessagesTokens(messages);
  const targetTokens = totalTokens / normalizedParts;
  const chunks: AgentMessage[][] = [];
  let current: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateCompactionMessageTokens(message);
    if (
      chunks.length < normalizedParts - 1 &&
      current.length > 0 &&
      currentTokens + messageTokens > targetTokens
    ) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }

    current.push(message);
    currentTokens += messageTokens;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// Overhead reserved for summarization prompt, system prompt, previous summary,
// and serialization wrappers (<conversation> tags, instructions, etc.).
// generateSummary uses reasoning: "high" which also consumes context budget.
export const SUMMARIZATION_OVERHEAD_TOKENS = 4096;

export function chunkMessagesByMaxTokens(
  messages: AgentMessage[],
  maxTokens: number,
): AgentMessage[][] {
  if (messages.length === 0) {
    return [];
  }

  // Apply safety margin to compensate for estimateTokens() underestimation
  // (chars/4 heuristic misses multi-byte chars, special tokens, code tokens, etc.)
  const effectiveMax = Math.max(1, Math.floor(maxTokens / SAFETY_MARGIN));

  const chunks: AgentMessage[][] = [];
  let currentChunk: AgentMessage[] = [];
  let currentTokens = 0;

  for (const message of messages) {
    const messageTokens = estimateCompactionMessageTokens(message);
    if (currentChunk.length > 0 && currentTokens + messageTokens > effectiveMax) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(message);
    currentTokens += messageTokens;

    if (messageTokens > effectiveMax) {
      // Split oversized messages to avoid unbounded chunk growth.
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Compute adaptive chunk ratio based on average message size.
 * When messages are large, we use smaller chunks to avoid exceeding model limits.
 */
export function computeAdaptiveChunkRatio(messages: AgentMessage[], contextWindow: number): number {
  if (messages.length === 0) {
    return BASE_CHUNK_RATIO;
  }

  const totalTokens = estimateMessagesTokens(messages);
  const avgTokens = totalTokens / messages.length;

  // Apply safety margin to account for estimation inaccuracy
  const safeAvgTokens = avgTokens * SAFETY_MARGIN;
  const avgRatio = safeAvgTokens / contextWindow;

  // If average message is > 10% of context, reduce chunk ratio
  if (avgRatio > 0.1) {
    const reduction = Math.min(avgRatio * 2, BASE_CHUNK_RATIO - MIN_CHUNK_RATIO);
    return Math.max(MIN_CHUNK_RATIO, BASE_CHUNK_RATIO - reduction);
  }

  return BASE_CHUNK_RATIO;
}

/**
 * Check if a single message is too large to summarize.
 * If single message > 50% of context, it can't be summarized safely.
 */
export function isOversizedForSummary(msg: AgentMessage, contextWindow: number): boolean {
  const tokens = estimateCompactionMessageTokens(msg) * SAFETY_MARGIN;
  return tokens > contextWindow * 0.5;
}

async function summarizeChunks(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  customInstructions?: string;
  summarizationInstructions?: CompactionSummarizationInstructions;
  previousSummary?: string;
}): Promise<string> {
  if (params.messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // SECURITY: never feed toolResult.details into summarization prompts.
  const safeMessages = stripToolResultDetails(params.messages);
  const chunks = chunkMessagesByMaxTokens(safeMessages, params.maxChunkTokens);
  let summary = params.previousSummary;
  const effectiveInstructions = buildCompactionSummarizationInstructions(
    params.customInstructions,
    params.summarizationInstructions,
  );
  for (const chunk of chunks) {
    summary = await retryAsync(
      () =>
        generateSummary(
          chunk,
          params.model,
          params.reserveTokens,
          params.apiKey,
          params.signal,
          effectiveInstructions,
          summary,
        ),
      {
        attempts: 3,
        minDelayMs: 500,
        maxDelayMs: 5000,
        jitter: 0.2,
        label: "compaction/generateSummary",
        shouldRetry: (err) => !(err instanceof Error && err.name === "AbortError"),
      },
    );
  }

  return summary ?? DEFAULT_SUMMARY_FALLBACK;
}

/**
 * Summarize with progressive fallback for handling oversized messages.
 * If full summarization fails, tries partial summarization excluding oversized messages.
 */
export async function summarizeWithFallback(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  summarizationInstructions?: CompactionSummarizationInstructions;
  previousSummary?: string;
}): Promise<string> {
  const { messages, contextWindow } = params;

  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  // Try full summarization first
  try {
    return await summarizeChunks(params);
  } catch (fullError) {
    log.warn(
      `Full summarization failed, trying partial: ${
        fullError instanceof Error ? fullError.message : String(fullError)
      }`,
    );
  }

  // Fallback 1: Summarize only small messages, note oversized ones
  const smallMessages: AgentMessage[] = [];
  const oversizedNotes: string[] = [];

  for (const msg of messages) {
    if (isOversizedForSummary(msg, contextWindow)) {
      const role = (msg as { role?: string }).role ?? "message";
      const tokens = estimateCompactionMessageTokens(msg);
      oversizedNotes.push(
        `[Large ${role} (~${Math.round(tokens / 1000)}K tokens) omitted from summary]`,
      );
    } else {
      smallMessages.push(msg);
    }
  }

  if (smallMessages.length > 0) {
    try {
      const partialSummary = await summarizeChunks({
        ...params,
        messages: smallMessages,
      });
      const notes = oversizedNotes.length > 0 ? `\n\n${oversizedNotes.join("\n")}` : "";
      return partialSummary + notes;
    } catch (partialError) {
      log.warn(
        `Partial summarization also failed: ${
          partialError instanceof Error ? partialError.message : String(partialError)
        }`,
      );
    }
  }

  // Final fallback: Just note what was there
  return (
    `Context contained ${messages.length} messages (${oversizedNotes.length} oversized). ` +
    `Summary unavailable due to size limits.`
  );
}

export async function summarizeInStages(params: {
  messages: AgentMessage[];
  model: NonNullable<ExtensionContext["model"]>;
  apiKey: string;
  signal: AbortSignal;
  reserveTokens: number;
  maxChunkTokens: number;
  contextWindow: number;
  customInstructions?: string;
  summarizationInstructions?: CompactionSummarizationInstructions;
  previousSummary?: string;
  parts?: number;
  minMessagesForSplit?: number;
}): Promise<string> {
  const { messages } = params;
  if (messages.length === 0) {
    return params.previousSummary ?? DEFAULT_SUMMARY_FALLBACK;
  }

  const minMessagesForSplit = Math.max(2, params.minMessagesForSplit ?? 4);
  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, messages.length);
  const totalTokens = estimateMessagesTokens(messages);

  if (parts <= 1 || messages.length < minMessagesForSplit || totalTokens <= params.maxChunkTokens) {
    return summarizeWithFallback(params);
  }

  const splits = splitMessagesByTokenShare(messages, parts).filter((chunk) => chunk.length > 0);
  if (splits.length <= 1) {
    return summarizeWithFallback(params);
  }

  const partialSummaries: string[] = [];
  for (const chunk of splits) {
    partialSummaries.push(
      await summarizeWithFallback({
        ...params,
        messages: chunk,
        previousSummary: undefined,
      }),
    );
  }

  if (partialSummaries.length === 1) {
    return partialSummaries[0];
  }

  const summaryMessages: AgentMessage[] = partialSummaries.map((summary) => ({
    role: "user",
    content: summary,
    timestamp: Date.now(),
  }));

  const custom = params.customInstructions?.trim();
  const mergeInstructions = custom
    ? `${MERGE_SUMMARIES_INSTRUCTIONS}\n\n${custom}`
    : MERGE_SUMMARIES_INSTRUCTIONS;

  return summarizeWithFallback({
    ...params,
    messages: summaryMessages,
    customInstructions: mergeInstructions,
  });
}

export function pruneHistoryForContextShare(params: {
  messages: AgentMessage[];
  maxContextTokens: number;
  maxHistoryShare?: number;
  parts?: number;
  pruningStrategy?: "recency" | "relevance";
  recentIdentifierWindow?: number;
}): {
  messages: AgentMessage[];
  droppedMessagesList: AgentMessage[];
  droppedChunks: number;
  droppedMessages: number;
  droppedTokens: number;
  keptTokens: number;
  budgetTokens: number;
} {
  const maxHistoryShare = params.maxHistoryShare ?? 0.5;
  const budgetTokens = Math.max(1, Math.floor(params.maxContextTokens * maxHistoryShare));
  let keptMessages = params.messages;
  const allDroppedMessages: AgentMessage[] = [];
  let droppedChunks = 0;
  let droppedMessages = 0;
  let droppedTokens = 0;
  const pruningStrategy = params.pruningStrategy ?? "recency";
  const recentIdentifierWindow = params.recentIdentifierWindow;

  const parts = normalizeParts(params.parts ?? DEFAULT_PARTS, keptMessages.length);

  while (keptMessages.length > 0 && estimateMessagesTokens(keptMessages) > budgetTokens) {
    const chunks = splitMessagesByTokenShare(keptMessages, parts);
    if (chunks.length <= 1) {
      break;
    }
    const recentIdentifiers =
      pruningStrategy === "relevance"
        ? collectRecentIdentifiers(keptMessages, recentIdentifierWindow)
        : new Set<string>();
    const dropChunkIndex = resolveDropChunkIndex({
      chunks,
      pruningStrategy,
      recentIdentifiers,
    });
    const dropped = chunks[dropChunkIndex] ?? [];
    const flatRest = chunks.filter((_, index) => index !== dropChunkIndex).flat();

    // After dropping a chunk, repair tool_use/tool_result pairing to handle
    // orphaned tool_results (whose tool_use was in the dropped chunk).
    // repairToolUseResultPairing drops orphaned tool_results, preventing
    // "unexpected tool_use_id" errors from Anthropic's API.
    const repairReport = repairToolUseResultPairing(flatRest);
    const repairedKept = repairReport.messages;

    // Track orphaned tool_results as dropped (they were in kept but their tool_use was dropped)
    const orphanedCount = repairReport.droppedOrphanCount;

    droppedChunks += 1;
    droppedMessages += dropped.length + orphanedCount;
    droppedTokens += estimateMessagesTokens(dropped);
    // Note: We don't have the actual orphaned messages to add to droppedMessagesList
    // since repairToolUseResultPairing doesn't return them. This is acceptable since
    // the dropped messages are used for summarization, and orphaned tool_results
    // without their tool_use context aren't useful for summarization anyway.
    allDroppedMessages.push(...dropped);
    keptMessages = repairedKept;
  }

  return {
    messages: keptMessages,
    droppedMessagesList: allDroppedMessages,
    droppedChunks,
    droppedMessages,
    droppedTokens,
    keptTokens: estimateMessagesTokens(keptMessages),
    budgetTokens,
  };
}

export function resolveContextWindowTokens(model?: ExtensionContext["model"]): number {
  return Math.max(1, Math.floor(model?.contextWindow ?? DEFAULT_CONTEXT_TOKENS));
}

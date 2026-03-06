import { z } from "zod";
import { isValidNonNegativeByteSizeString } from "./byte-size.js";
import {
  HeartbeatSchema,
  AgentSandboxSchema,
  AgentModelSchema,
  MemorySearchSchema,
} from "./zod-schema.agent-runtime.js";
import {
  BlockStreamingChunkSchema,
  BlockStreamingCoalesceSchema,
  CliBackendSchema,
  HumanDelaySchema,
  TypingModeSchema,
} from "./zod-schema.core.js";

const ModelRoutingSchema = z
  .object({
    enabled: z.boolean().optional(),
    plannerModel: z.string().optional(),
    retrievalModel: z.string().optional(),
    compressionModel: z.string().optional(),
    verificationModel: z.string().optional(),
    escalation: z
      .object({
        minConfidence: z.number().min(0).max(1).optional(),
        maxCheapPasses: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const AgentDefaultsSchema = z
  .object({
    model: AgentModelSchema.optional(),
    imageModel: AgentModelSchema.optional(),
    pdfModel: AgentModelSchema.optional(),
    pdfMaxBytesMb: z.number().positive().optional(),
    pdfMaxPages: z.number().int().positive().optional(),
    models: z
      .record(
        z.string(),
        z
          .object({
            alias: z.string().optional(),
            /** Provider-specific API parameters (e.g., GLM-4.7 thinking mode). */
            params: z.record(z.string(), z.unknown()).optional(),
            /** Enable streaming for this model (default: true, false for Ollama to avoid SDK issue #1205). */
            streaming: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
    workspace: z.string().optional(),
    repoRoot: z.string().optional(),
    skipBootstrap: z.boolean().optional(),
    bootstrapMaxChars: z.number().int().positive().optional(),
    bootstrapTotalMaxChars: z.number().int().positive().optional(),
    userTimezone: z.string().optional(),
    timeFormat: z.union([z.literal("auto"), z.literal("12"), z.literal("24")]).optional(),
    envelopeTimezone: z.string().optional(),
    envelopeTimestamp: z.union([z.literal("on"), z.literal("off")]).optional(),
    envelopeElapsed: z.union([z.literal("on"), z.literal("off")]).optional(),
    contextTokens: z.number().int().positive().optional(),
    cliBackends: z.record(z.string(), CliBackendSchema).optional(),
    memorySearch: MemorySearchSchema,
    modelRouting: ModelRoutingSchema,
    skills: z
      .object({
        promptMode: z.union([z.literal("full"), z.literal("compact")]).optional(),
      })
      .strict()
      .optional(),
    contextPruning: z
      .object({
        mode: z.union([z.literal("off"), z.literal("cache-ttl")]).optional(),
        ttl: z.string().optional(),
        keepLastAssistants: z.number().int().nonnegative().optional(),
        softTrimRatio: z.number().min(0).max(1).optional(),
        hardClearRatio: z.number().min(0).max(1).optional(),
        minPrunableToolChars: z.number().int().nonnegative().optional(),
        tools: z
          .object({
            allow: z.array(z.string()).optional(),
            deny: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
        softTrim: z
          .object({
            maxChars: z.number().int().nonnegative().optional(),
            headChars: z.number().int().nonnegative().optional(),
            tailChars: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
        hardClear: z
          .object({
            enabled: z.boolean().optional(),
            placeholder: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    compaction: z
      .object({
        mode: z.union([z.literal("default"), z.literal("safeguard")]).optional(),
        reserveTokens: z.number().int().nonnegative().optional(),
        keepRecentTokens: z.number().int().positive().optional(),
        reserveTokensFloor: z.number().int().nonnegative().optional(),
        maxHistoryShare: z.number().min(0.1).max(0.9).optional(),
        identifierPolicy: z
          .union([z.literal("strict"), z.literal("off"), z.literal("custom")])
          .optional(),
        pruningStrategy: z.union([z.literal("recency"), z.literal("relevance")]).optional(),
        identifierInstructions: z.string().optional(),
        memoryFlush: z
          .object({
            enabled: z.boolean().optional(),
            softThresholdTokens: z.number().int().nonnegative().optional(),
            forceFlushTranscriptBytes: z
              .union([
                z.number().int().nonnegative(),
                z
                  .string()
                  .refine(isValidNonNegativeByteSizeString, "Expected byte size string like 2mb"),
              ])
              .optional(),
            prompt: z.string().optional(),
            systemPrompt: z.string().optional(),
            periodicTurnInterval: z.number().int().nonnegative().optional(),
            periodicMinutes: z.number().int().nonnegative().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    embeddedPi: z
      .object({
        projectSettingsPolicy: z
          .union([z.literal("trusted"), z.literal("sanitize"), z.literal("ignore")])
          .optional(),
      })
      .strict()
      .optional(),
    thinkingDefault: z
      .union([
        z.literal("off"),
        z.literal("minimal"),
        z.literal("low"),
        z.literal("medium"),
        z.literal("high"),
        z.literal("xhigh"),
        z.literal("adaptive"),
      ])
      .optional(),
    verboseDefault: z.union([z.literal("off"), z.literal("on"), z.literal("full")]).optional(),
    elevatedDefault: z
      .union([z.literal("off"), z.literal("on"), z.literal("ask"), z.literal("full")])
      .optional(),
    blockStreamingDefault: z.union([z.literal("off"), z.literal("on")]).optional(),
    blockStreamingBreak: z.union([z.literal("text_end"), z.literal("message_end")]).optional(),
    blockStreamingChunk: BlockStreamingChunkSchema.optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    humanDelay: HumanDelaySchema.optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    mediaMaxMb: z.number().positive().optional(),
    imageMaxDimensionPx: z.number().int().positive().optional(),
    typingIntervalSeconds: z.number().int().positive().optional(),
    typingMode: TypingModeSchema.optional(),
    heartbeat: HeartbeatSchema,
    maxConcurrent: z.number().int().positive().optional(),
    subagents: z
      .object({
        maxConcurrent: z.number().int().positive().optional(),
        maxSpawnDepth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe(
            "Maximum nesting depth for sub-agent spawning. 1 = no nesting (default), 2 = sub-agents can spawn sub-sub-agents.",
          ),
        maxChildrenPerAgent: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Maximum number of active children a single agent session can spawn (default: 5).",
          ),
        archiveAfterMinutes: z.number().int().positive().optional(),
        model: AgentModelSchema.optional(),
        autoTier: z.boolean().optional(),
        simpleTaskModel: z.string().optional(),
        thinking: z.string().optional(),
        runTimeoutSeconds: z.number().int().min(0).optional(),
        announceTimeoutMs: z.number().int().positive().optional(),
        delegation: z
          .object({
            enabled: z.boolean().optional(),
            structuredResults: z.boolean().optional(),
            parallelResearch: z
              .object({
                enabled: z.boolean().optional(),
                maxConcurrent: z.number().int().positive().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    sandbox: AgentSandboxSchema,
  })
  .strict()
  .optional();




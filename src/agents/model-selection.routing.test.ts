import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  resolvePhaseAwareThinkLevel,
  resolveStageAwareModelSelection,
  resolveSubagentSpawnModelSelection,
} from "./model-selection.js";

function makeConfig(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        modelRouting: {
          enabled: true,
          retrievalModel: "anthropic/claude-haiku-4-5",
          compressionModel: "openai/gpt-5-mini",
          verificationModel: "openai/gpt-5-nano",
          escalation: {
            minConfidence: 0.65,
            maxCheapPasses: 2,
          },
        },
        subagents: {
          simpleTaskModel: "anthropic/claude-haiku-4-5",
        },
      },
    },
  } as OpenClawConfig;
}

describe("model-selection stage routing", () => {
  it("routes cheap retrieval phases when confidence is sufficient", () => {
    const cfg = makeConfig();

    expect(
      resolveStageAwareModelSelection({
        cfg,
        phase: "retrieval",
        evidenceConfidence: 0.8,
        cheapPassIndex: 1,
      }),
    ).toBe("anthropic/claude-haiku-4-5");

    expect(
      resolveStageAwareModelSelection({
        cfg,
        phase: "retrieval",
        evidenceConfidence: 0.4,
        cheapPassIndex: 1,
      }),
    ).toBeUndefined();
  });

  it("lowers adaptive thinking for compression-style phases", () => {
    expect(resolvePhaseAwareThinkLevel({ phase: "compression", thinkLevel: "adaptive" })).toBe(
      "minimal",
    );
    expect(resolvePhaseAwareThinkLevel({ phase: "verification", thinkLevel: "adaptive" })).toBe(
      "low",
    );
  });

  it("routes research subagents to retrieval-tier models before auto-tiering", () => {
    const cfg = makeConfig();

    expect(
      resolveSubagentSpawnModelSelection({
        cfg,
        agentId: "research",
        taskDescription: "investigate the regression across two files",
        role: "research",
      }),
    ).toBe("anthropic/claude-haiku-4-5");
  });
});

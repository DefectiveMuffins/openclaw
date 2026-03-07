import { beforeEach, describe, expect, it } from "vitest";
import {
  getCallGatewayMock,
  getSessionsSpawnTool,
  resetSessionsSpawnConfigOverride,
  setSessionsSpawnConfigOverride,
} from "./openclaw-tools.subagents.sessions-spawn.test-harness.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

const callGatewayMock = getCallGatewayMock();

describe("sessions_spawn delegation contracts", () => {
  beforeEach(() => {
    resetSessionsSpawnConfigOverride();
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
  });

  it("applies delegation defaults for research workers and injects the contract prompt", async () => {
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          modelRouting: {
            enabled: true,
            retrievalModel: "anthropic/claude-haiku-4-5",
          },
          subagents: {
            delegation: {
              enabled: true,
              structuredResults: true,
            },
          },
        },
      },
    });

    const calls: Array<{ method?: string; params?: unknown }> = [];
    let agentParams: Record<string, unknown> | undefined;

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      calls.push(request);
      if (request.method === "sessions.patch") {
        return { ok: true };
      }
      if (request.method === "agent") {
        agentParams = request.params as Record<string, unknown>;
        return { runId: "run-delegation", status: "accepted" };
      }
      return {};
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("call-delegation", {
      task: "Investigate the cache invalidation flow",
      role: "research",
      deliverable: "Return the regression cause and touched files",
      acceptance: ["cite the file paths", "list any residual risks"],
    });

    expect(result.details).toMatchObject({
      status: "accepted",
      delegation: {
        role: "research",
        responseFormat: "structured",
        readOnly: true,
      },
    });
    expect(agentParams?.thinking).toBe("low");
    const extraSystemPrompt = agentParams?.extraSystemPrompt;
    expect(typeof extraSystemPrompt).toBe("string");
    if (typeof extraSystemPrompt !== "string") {
      throw new TypeError("expected string extraSystemPrompt");
    }
    expect(extraSystemPrompt).toContain("## Delegation Contract");
    expect(extraSystemPrompt).toContain("Role: research");
    expect(extraSystemPrompt).toContain("Return the regression cause and touched files");
    const modelPatch = calls.find(
      (call) => call.method === "sessions.patch" && (call.params as { model?: string })?.model,
    );
    expect(modelPatch?.params).toMatchObject({
      model: "anthropic/claude-haiku-4-5",
    });
  });
});

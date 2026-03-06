import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bash-tools.exec-host-gateway.js", () => ({
  processGatewayAllowlist: vi.fn(),
}));

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return {
    ...mod,
    getShellPathFromLoginShell: vi.fn(() => null),
    resolveShellEnvFallbackTimeoutMs: vi.fn(() => 0),
  };
});

let createExecTool: typeof import("./bash-tools.exec.js").createExecTool;
let processGatewayAllowlist: typeof import("./bash-tools.exec-host-gateway.js").processGatewayAllowlist;

describe("exec destructive command controls", () => {
  beforeAll(async () => {
    ({ createExecTool } = await import("./bash-tools.exec.js"));
    ({ processGatewayAllowlist } = await import("./bash-tools.exec-host-gateway.js"));
  });

  beforeEach(() => {
    vi.mocked(processGatewayAllowlist).mockReset();
  });

  it("blocks destructive commands when destructiveMode=block", async () => {
    const tool = createExecTool({
      host: "gateway",
      security: "allowlist",
      ask: "off",
      blockDestructive: true,
      destructiveMode: "block",
    });

    const result = await tool.execute("call-block", {
      command: "git reset --hard HEAD~1",
    });
    const text = result.content.find((entry) => entry.type === "text")?.text ?? "";

    expect(result.details.status).toBe("failed");
    expect(text).toContain("Command blocked: destructive command detected (git-reset-hard).");
    expect(vi.mocked(processGatewayAllowlist)).not.toHaveBeenCalled();
  });

  it("routes destructive commands through approval flow when destructiveMode=approve", async () => {
    let capturedAsk: string | undefined;
    vi.mocked(processGatewayAllowlist).mockImplementation(async (params) => {
      capturedAsk = params.ask;
      return {
        pendingResult: {
          content: [{ type: "text", text: "approval required" }],
          details: {
            status: "approval-pending",
            approvalId: "approval-id",
            approvalSlug: "approval-id",
            expiresAtMs: Date.now() + 60_000,
            host: "gateway",
            command: params.command,
            cwd: params.workdir,
          },
        },
      };
    });

    const tool = createExecTool({
      host: "gateway",
      security: "allowlist",
      ask: "off",
      blockDestructive: true,
      destructiveMode: "approve",
    });

    const result = await tool.execute("call-approve", {
      command: "rm -rf ./tmp",
    });

    expect(result.details.status).toBe("approval-pending");
    expect(capturedAsk).toBe("always");
    expect(vi.mocked(processGatewayAllowlist)).toHaveBeenCalledTimes(1);
  });

  it("rejects approve routing when host=sandbox with active sandbox runtime", async () => {
    const tool = createExecTool({
      host: "sandbox",
      security: "allowlist",
      ask: "off",
      blockDestructive: true,
      destructiveMode: "approve",
      sandbox: {
        containerName: "test-sandbox",
        workspaceDir: process.cwd(),
        containerWorkdir: "/workspace",
      },
    });

    const result = await tool.execute("call-sandbox-approve", {
      command: "rm -rf ./tmp",
    });
    const text = result.content.find((entry) => entry.type === "text")?.text ?? "";

    expect(result.details.status).toBe("failed");
    expect(text).toContain("approval routing is unavailable for this exec host");
    expect(vi.mocked(processGatewayAllowlist)).not.toHaveBeenCalled();
  });
});

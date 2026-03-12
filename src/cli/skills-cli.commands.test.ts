import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn();
const resolveAgentWorkspaceDirMock = vi.fn();
const resolveDefaultAgentIdMock = vi.fn();
const buildWorkspaceSkillStatusMock = vi.fn();
const loadWorkspaceSkillEntriesMock = vi.fn();
const auditSkillEntriesMock = vi.fn();
const setSkillTrustDecisionMock = vi.fn();
const formatSkillsListMock = vi.fn();
const formatSkillInfoMock = vi.fn();
const formatSkillsCheckMock = vi.fn();

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

vi.mock("../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: resolveAgentWorkspaceDirMock,
  resolveDefaultAgentId: resolveDefaultAgentIdMock,
}));

vi.mock("../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus: buildWorkspaceSkillStatusMock,
}));

vi.mock("../agents/skills.js", () => ({
  loadWorkspaceSkillEntries: loadWorkspaceSkillEntriesMock,
  auditSkillEntries: auditSkillEntriesMock,
  setSkillTrustDecision: setSkillTrustDecisionMock,
}));

vi.mock("./skills-cli.format.js", () => ({
  formatSkillsList: formatSkillsListMock,
  formatSkillInfo: formatSkillInfoMock,
  formatSkillsCheck: formatSkillsCheckMock,
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: runtime,
}));

let registerSkillsCli: typeof import("./skills-cli.js").registerSkillsCli;

beforeAll(async () => {
  ({ registerSkillsCli } = await import("./skills-cli.js"));
});

describe("registerSkillsCli", () => {
  const report = {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/workspace/.skills",
    skills: [],
  };

  async function runCli(args: string[]) {
    const program = new Command();
    registerSkillsCli(program);
    await program.parseAsync(args, { from: "user" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue({ gateway: {} });
    resolveDefaultAgentIdMock.mockReturnValue("main");
    resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
    buildWorkspaceSkillStatusMock.mockReturnValue(report);
    loadWorkspaceSkillEntriesMock.mockReturnValue([
      {
        skill: {
          name: "peekaboo",
          description: "peekaboo",
          source: "openclaw-workspace",
          filePath: "/tmp/workspace/skills/peekaboo/SKILL.md",
          baseDir: "/tmp/workspace/skills/peekaboo",
        },
        metadata: { skillKey: "peekaboo" },
      },
    ]);
    auditSkillEntriesMock.mockReturnValue([
      {
        entry: {
          skill: {
            name: "peekaboo",
            description: "peekaboo",
            source: "openclaw-workspace",
            filePath: "/tmp/workspace/skills/peekaboo/SKILL.md",
            baseDir: "/tmp/workspace/skills/peekaboo",
          },
          metadata: { skillKey: "peekaboo" },
        },
        audit: {
          quarantined: true,
          auditStatus: "warn",
          trustReason: "new",
          auditSummary: { scannedFiles: 1, critical: 0, warn: 1, info: 0, findingsPreview: [] },
        },
        findings: [],
      },
    ]);
    setSkillTrustDecisionMock.mockReturnValue({
      quarantined: false,
      auditStatus: "clean",
      trustReason: "approved",
    });
    formatSkillsListMock.mockReturnValue("skills-list-output");
    formatSkillInfoMock.mockReturnValue("skills-info-output");
    formatSkillsCheckMock.mockReturnValue("skills-check-output");
  });

  it("runs list command with resolved report and formatter options", async () => {
    await runCli(["skills", "list", "--eligible", "--verbose", "--json"]);

    expect(buildWorkspaceSkillStatusMock).toHaveBeenCalledWith("/tmp/workspace", {
      config: { gateway: {} },
    });
    expect(formatSkillsListMock).toHaveBeenCalledWith(
      report,
      expect.objectContaining({
        eligible: true,
        verbose: true,
        json: true,
      }),
    );
    expect(runtime.log).toHaveBeenCalledWith("skills-list-output");
  });

  it("runs info command and forwards skill name", async () => {
    await runCli(["skills", "info", "peekaboo", "--json"]);

    expect(formatSkillInfoMock).toHaveBeenCalledWith(
      report,
      "peekaboo",
      expect.objectContaining({ json: true }),
    );
    expect(runtime.log).toHaveBeenCalledWith("skills-info-output");
  });

  it("runs check command and writes formatter output", async () => {
    await runCli(["skills", "check"]);

    expect(formatSkillsCheckMock).toHaveBeenCalledWith(report, expect.any(Object));
    expect(runtime.log).toHaveBeenCalledWith("skills-check-output");
  });

  it("uses list formatter for default skills action", async () => {
    await runCli(["skills"]);

    expect(formatSkillsListMock).toHaveBeenCalledWith(report, {});
    expect(runtime.log).toHaveBeenCalledWith("skills-list-output");
  });

  it("runs audit command and logs audit output", async () => {
    await runCli(["skills", "audit", "peekaboo"]);

    expect(loadWorkspaceSkillEntriesMock).toHaveBeenCalledWith("/tmp/workspace", {
      config: { gateway: {} },
    });
    expect(auditSkillEntriesMock).toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("peekaboo"));
  });

  it("runs trust approve command", async () => {
    await runCli(["skills", "trust", "approve", "peekaboo"]);

    expect(setSkillTrustDecisionMock).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        skill: expect.objectContaining({ name: "peekaboo" }),
      }),
      action: "approve",
    });
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Approved"));
  });

  it("reports runtime errors when report loading fails", async () => {
    loadConfigMock.mockImplementationOnce(() => {
      throw new Error("config exploded");
    });

    await runCli(["skills", "list"]);

    expect(runtime.error).toHaveBeenCalledWith("Error: config exploded");
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(buildWorkspaceSkillStatusMock).not.toHaveBeenCalled();
  });
});

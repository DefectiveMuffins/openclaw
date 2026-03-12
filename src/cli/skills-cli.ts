import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  auditSkillEntries,
  loadWorkspaceSkillEntries,
  setSkillTrustDecision,
  type SkillEntry,
} from "../agents/skills.js";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";

export type {
  SkillInfoOptions,
  SkillsCheckOptions,
  SkillsListOptions,
} from "./skills-cli.format.js";
export { formatSkillInfo, formatSkillsCheck, formatSkillsList } from "./skills-cli.format.js";

type SkillStatusReport = Awaited<
  ReturnType<(typeof import("../agents/skills-status.js"))["buildWorkspaceSkillStatus"]>
>;

type SkillsContext = {
  workspaceDir: string;
  report: SkillStatusReport;
  entries: SkillEntry[];
};

async function loadSkillsContext(): Promise<SkillsContext> {
  const config = loadConfig();
  const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
  const { buildWorkspaceSkillStatus } = await import("../agents/skills-status.js");
  return {
    workspaceDir,
    report: buildWorkspaceSkillStatus(workspaceDir, { config }),
    entries: loadWorkspaceSkillEntries(workspaceDir, { config }),
  };
}

async function loadSkillsStatusReport(): Promise<SkillStatusReport> {
  return (await loadSkillsContext()).report;
}

async function runSkillsAction(render: (report: SkillStatusReport) => string): Promise<void> {
  try {
    const report = await loadSkillsStatusReport();
    defaultRuntime.log(render(report));
  } catch (err) {
    defaultRuntime.error(String(err));
    defaultRuntime.exit(1);
  }
}

function resolveSkillKey(entry: SkillEntry): string {
  return entry.metadata?.skillKey ?? entry.skill.name;
}

function findSkillEntry(entries: SkillEntry[], name: string): SkillEntry | undefined {
  const normalized = name.trim();
  return entries.find(
    (entry) => entry.skill.name === normalized || resolveSkillKey(entry) === normalized,
  );
}

function formatSkillAuditOutput(
  results: ReturnType<typeof auditSkillEntries>,
  opts?: { json?: boolean },
): string {
  if (opts?.json) {
    return JSON.stringify(
      results.map((result) => ({
        name: result.entry.skill.name,
        skillKey: resolveSkillKey(result.entry),
        source: result.entry.skill.source,
        quarantined: result.audit.quarantined,
        auditStatus: result.audit.auditStatus,
        auditSummary: result.audit.auditSummary,
        lastScannedAt: result.audit.lastScannedAt,
        trustReason: result.audit.trustReason,
        findings: result.findings,
      })),
      null,
      2,
    );
  }

  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${theme.heading(result.entry.skill.name)} ${theme.muted(`(${result.audit.auditStatus}; ${result.audit.trustReason.replaceAll("_", " ")})`)}`,
    );
    if (result.audit.auditSummary) {
      lines.push(
        `  files=${result.audit.auditSummary.scannedFiles} critical=${result.audit.auditSummary.critical} warn=${result.audit.auditSummary.warn} quarantined=${result.audit.quarantined ? "yes" : "no"}`,
      );
    }
    if (result.findings.length === 0) {
      lines.push("  no findings");
    } else {
      for (const finding of result.findings) {
        lines.push(
          `  - [${finding.severity}] ${finding.message} (${finding.file}:${finding.line})`,
        );
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Register the skills CLI commands
 */
export function registerSkillsCli(program: Command) {
  const skills = program
    .command("skills")
    .description("List and inspect available skills")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/skills", "docs.openclaw.ai/cli/skills")}\n`,
    );

  skills
    .command("list")
    .description("List all available skills")
    .option("--json", "Output as JSON", false)
    .option("--eligible", "Show only eligible (ready to use) skills", false)
    .option("-v, --verbose", "Show more details including missing requirements", false)
    .action(async (opts) => {
      await runSkillsAction((report) => formatSkillsList(report, opts));
    });

  skills
    .command("info")
    .description("Show detailed information about a skill")
    .argument("<name>", "Skill name")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      await runSkillsAction((report) => formatSkillInfo(report, name, opts));
    });

  skills
    .command("check")
    .description("Check which skills are ready vs missing requirements")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runSkillsAction((report) => formatSkillsCheck(report, opts));
    });

  skills
    .command("audit")
    .description("Rescan one skill or all skills for audit findings")
    .argument("[name]", "Optional skill name or skill key")
    .option("--json", "Output as JSON", false)
    .action(async (name: string | undefined, opts) => {
      try {
        const context = await loadSkillsContext();
        const selected = name ? findSkillEntry(context.entries, name) : undefined;
        if (name && !selected) {
          defaultRuntime.error(`Skill "${name}" not found`);
          defaultRuntime.exit(1);
          return;
        }
        defaultRuntime.log(
          formatSkillAuditOutput(
            auditSkillEntries(selected ? [selected] : context.entries, { forceRescan: true }),
            opts,
          ),
        );
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  const trust = skills
    .command("trust")
    .description("Approve or revoke trust for the current fingerprint of a skill");

  for (const action of ["approve", "revoke"] as const) {
    trust
      .command(action)
      .argument("<name>", "Skill name or skill key")
      .option("--json", "Output as JSON", false)
      .action(async (name: string, opts) => {
        try {
          const context = await loadSkillsContext();
          const entry = findSkillEntry(context.entries, name);
          if (!entry) {
            defaultRuntime.error(`Skill "${name}" not found`);
            defaultRuntime.exit(1);
            return;
          }
          const audit = setSkillTrustDecision({ entry, action });
          const payload = {
            ok: true,
            skillKey: resolveSkillKey(entry),
            action,
            quarantined: audit.quarantined,
            auditStatus: audit.auditStatus,
            trustReason: audit.trustReason,
          };
          defaultRuntime.log(
            opts.json
              ? JSON.stringify(payload, null, 2)
              : `${action === "approve" ? "Approved" : "Revoked trust for"} ${payload.skillKey} (${payload.auditStatus}; ${payload.trustReason.replaceAll("_", " ")})`,
          );
        } catch (err) {
          defaultRuntime.error(String(err));
          defaultRuntime.exit(1);
        }
      });
  }

  // Default action (no subcommand) - show list
  skills.action(async () => {
    await runSkillsAction((report) => formatSkillsList(report, {}));
  });
}

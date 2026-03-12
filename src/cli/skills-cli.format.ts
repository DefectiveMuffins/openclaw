import type { SkillStatusEntry, SkillStatusReport } from "../agents/skills-status.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

export type SkillsListOptions = {
  json?: boolean;
  eligible?: boolean;
  verbose?: boolean;
};

export type SkillInfoOptions = {
  json?: boolean;
};

export type SkillsCheckOptions = {
  json?: boolean;
};

export type SkillsAuditOptions = {
  json?: boolean;
};

function appendClawHubHint(output: string, json?: boolean): string {
  if (json) {
    return output;
  }
  return `${output}\n\nTip: use \`npx clawhub\` to search, install, and sync skills.`;
}

function formatSkillStatus(skill: SkillStatusEntry): string {
  if (skill.disabled) {
    return theme.warn("disabled");
  }
  if (skill.quarantined) {
    return theme.warn("quarantined");
  }
  if (skill.blockedByAllowlist) {
    return theme.warn("blocked");
  }
  if (skill.eligible) {
    return theme.success("ready");
  }
  return theme.error("missing");
}

function formatSkillName(skill: SkillStatusEntry): string {
  const emoji = skill.emoji ?? "skill";
  return `${emoji} ${theme.command(skill.name)}`;
}

function formatSkillMissingSummary(skill: SkillStatusEntry): string {
  const missing: string[] = [];
  if (skill.missing.bins.length > 0) {
    missing.push(`bins: ${skill.missing.bins.join(", ")}`);
  }
  if (skill.missing.anyBins.length > 0) {
    missing.push(`anyBins: ${skill.missing.anyBins.join(", ")}`);
  }
  if (skill.missing.env.length > 0) {
    missing.push(`env: ${skill.missing.env.join(", ")}`);
  }
  if (skill.missing.config.length > 0) {
    missing.push(`config: ${skill.missing.config.join(", ")}`);
  }
  if (skill.missing.os.length > 0) {
    missing.push(`os: ${skill.missing.os.join(", ")}`);
  }
  return missing.join("; ");
}

function formatTrustSummary(skill: SkillStatusEntry): string {
  return `${skill.auditStatus}; ${skill.trustReason.replaceAll("_", " ")}`;
}

export function formatSkillsList(report: SkillStatusReport, opts: SkillsListOptions): string {
  const skills = opts.eligible ? report.skills.filter((s) => s.eligible) : report.skills;

  if (opts.json) {
    return JSON.stringify(
      {
        workspaceDir: report.workspaceDir,
        managedSkillsDir: report.managedSkillsDir,
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          emoji: s.emoji,
          eligible: s.eligible,
          disabled: s.disabled,
          blockedByAllowlist: s.blockedByAllowlist,
          quarantined: s.quarantined,
          auditStatus: s.auditStatus,
          auditSummary: s.auditSummary,
          lastScannedAt: s.lastScannedAt,
          trustReason: s.trustReason,
          source: s.source,
          bundled: s.bundled,
          primaryEnv: s.primaryEnv,
          homepage: s.homepage,
          missing: s.missing,
        })),
      },
      null,
      2,
    );
  }

  if (skills.length === 0) {
    const message = opts.eligible
      ? `No eligible skills found. Run \`${formatCliCommand("openclaw skills list")}\` to see all skills.`
      : "No skills found.";
    return appendClawHubHint(message, opts.json);
  }

  const eligible = skills.filter((s) => s.eligible);
  const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);
  const rows = skills.map((skill) => ({
    Status: formatSkillStatus(skill),
    Skill: formatSkillName(skill),
    Description: theme.muted(skill.description),
    Source: skill.source ?? "",
    Trust: skill.auditStatus === "not_applicable" ? "" : theme.muted(formatTrustSummary(skill)),
    Missing: (() => {
      const parts = [
        skill.quarantined ? `trust: ${formatTrustSummary(skill)}` : "",
        formatSkillMissingSummary(skill),
      ].filter(Boolean);
      return parts.length > 0 ? theme.warn(parts.join("; ")) : "";
    })(),
  }));

  const columns = [
    { key: "Status", header: "Status", minWidth: 12 },
    { key: "Skill", header: "Skill", minWidth: 18, flex: true },
    { key: "Description", header: "Description", minWidth: 24, flex: true },
    { key: "Source", header: "Source", minWidth: 10 },
    { key: "Trust", header: "Trust", minWidth: 16, flex: true },
  ];
  if (opts.verbose) {
    columns.push({ key: "Missing", header: "Missing", minWidth: 18, flex: true });
  }

  return appendClawHubHint(
    [
      `${theme.heading("Skills")} ${theme.muted(`(${eligible.length}/${skills.length} ready)`)}`,
      renderTable({ width: tableWidth, columns, rows }).trimEnd(),
    ].join("\n"),
    opts.json,
  );
}

export function formatSkillInfo(
  report: SkillStatusReport,
  skillName: string,
  opts: SkillInfoOptions,
): string {
  const skill = report.skills.find((s) => s.name === skillName || s.skillKey === skillName);

  if (!skill) {
    if (opts.json) {
      return JSON.stringify({ error: "not found", skill: skillName }, null, 2);
    }
    return appendClawHubHint(
      `Skill "${skillName}" not found. Run \`${formatCliCommand("openclaw skills list")}\` to see available skills.`,
      opts.json,
    );
  }

  if (opts.json) {
    return JSON.stringify(skill, null, 2);
  }

  const resolvedStatus = skill.disabled
    ? theme.warn("Disabled")
    : skill.quarantined
      ? theme.warn("Quarantined")
      : skill.blockedByAllowlist
        ? theme.warn("Blocked by allowlist")
        : skill.eligible
          ? theme.success("Ready")
          : theme.error("Missing requirements");
  const lines: string[] = [
    `${skill.emoji ?? "skill"} ${theme.heading(skill.name)} ${resolvedStatus}`,
    "",
    skill.description,
    "",
    theme.heading("Details:"),
    `${theme.muted("  Source:")} ${skill.source}`,
    `${theme.muted("  Path:")} ${shortenHomePath(skill.filePath)}`,
    `${theme.muted("  Trust:")} ${skill.trustReason.replaceAll("_", " ")}`,
    `${theme.muted("  Audit:")} ${skill.auditStatus}`,
  ];

  if (skill.homepage) {
    lines.push(`${theme.muted("  Homepage:")} ${skill.homepage}`);
  }
  if (skill.primaryEnv) {
    lines.push(`${theme.muted("  Primary env:")} ${skill.primaryEnv}`);
  }

  const hasRequirements =
    skill.requirements.bins.length > 0 ||
    skill.requirements.anyBins.length > 0 ||
    skill.requirements.env.length > 0 ||
    skill.requirements.config.length > 0 ||
    skill.requirements.os.length > 0;
  if (hasRequirements) {
    lines.push("", theme.heading("Requirements:"));
    if (skill.requirements.bins.length > 0) {
      lines.push(`${theme.muted("  Binaries:")} ${skill.requirements.bins.join(", ")}`);
    }
    if (skill.requirements.anyBins.length > 0) {
      lines.push(`${theme.muted("  Any binaries:")} ${skill.requirements.anyBins.join(", ")}`);
    }
    if (skill.requirements.env.length > 0) {
      lines.push(`${theme.muted("  Environment:")} ${skill.requirements.env.join(", ")}`);
    }
    if (skill.requirements.config.length > 0) {
      lines.push(`${theme.muted("  Config:")} ${skill.requirements.config.join(", ")}`);
    }
    if (skill.requirements.os.length > 0) {
      lines.push(`${theme.muted("  OS:")} ${skill.requirements.os.join(", ")}`);
    }
  }

  if (skill.install.length > 0 && !skill.eligible) {
    lines.push("", theme.heading("Install options:"));
    for (const option of skill.install) {
      lines.push(`  - ${option.label}`);
    }
  }

  if (skill.auditSummary && skill.auditStatus !== "not_applicable") {
    lines.push("", theme.heading("Audit summary:"));
    lines.push(
      `${theme.muted("  Files:")} ${skill.auditSummary.scannedFiles}  ${theme.muted("Critical:")} ${skill.auditSummary.critical}  ${theme.muted("Warn:")} ${skill.auditSummary.warn}`,
    );
    for (const finding of skill.auditSummary.findingsPreview) {
      lines.push(`  - [${finding.severity}] ${finding.message} (${finding.file}:${finding.line})`);
    }
    if (skill.quarantined) {
      lines.push(
        "",
        `Approve this fingerprint with \`${formatCliCommand(`openclaw skills trust approve ${skill.skillKey}`)}\`.`,
      );
    }
  }

  return appendClawHubHint(lines.join("\n"), opts.json);
}

export function formatSkillsCheck(report: SkillStatusReport, opts: SkillsCheckOptions): string {
  const eligible = report.skills.filter((s) => s.eligible);
  const disabled = report.skills.filter((s) => s.disabled);
  const quarantined = report.skills.filter((s) => s.quarantined && !s.disabled);
  const blocked = report.skills.filter((s) => s.blockedByAllowlist && !s.disabled);
  const missingReqs = report.skills.filter(
    (s) => !s.eligible && !s.disabled && !s.blockedByAllowlist && !s.quarantined,
  );

  if (opts.json) {
    return JSON.stringify(
      {
        summary: {
          total: report.skills.length,
          eligible: eligible.length,
          disabled: disabled.length,
          quarantined: quarantined.length,
          blocked: blocked.length,
          missingRequirements: missingReqs.length,
        },
        eligible: eligible.map((s) => s.name),
        disabled: disabled.map((s) => s.name),
        quarantined: quarantined.map((s) => ({
          name: s.name,
          auditStatus: s.auditStatus,
          trustReason: s.trustReason,
        })),
        blocked: blocked.map((s) => s.name),
        missingRequirements: missingReqs.map((s) => ({
          name: s.name,
          missing: s.missing,
          install: s.install,
        })),
      },
      null,
      2,
    );
  }

  const lines: string[] = [
    theme.heading("Skills Status Check"),
    "",
    `${theme.muted("Total:")} ${report.skills.length}`,
    `${theme.success("ok")} ${theme.muted("Eligible:")} ${eligible.length}`,
    `${theme.warn("off")} ${theme.muted("Disabled:")} ${disabled.length}`,
    `${theme.warn("!")} ${theme.muted("Quarantined:")} ${quarantined.length}`,
    `${theme.warn("blocked")} ${theme.muted("Blocked by allowlist:")} ${blocked.length}`,
    `${theme.error("missing")} ${theme.muted("Missing requirements:")} ${missingReqs.length}`,
  ];

  if (eligible.length > 0) {
    lines.push("", theme.heading("Ready to use:"));
    for (const skill of eligible) {
      lines.push(`  ${skill.emoji ?? "skill"} ${skill.name}`);
    }
  }

  if (quarantined.length > 0) {
    lines.push("", theme.heading("Quarantined:"));
    for (const skill of quarantined) {
      lines.push(
        `  ${skill.emoji ?? "skill"} ${skill.name} ${theme.muted(`(${formatTrustSummary(skill)})`)}`,
      );
    }
  }

  if (missingReqs.length > 0) {
    lines.push("", theme.heading("Missing requirements:"));
    for (const skill of missingReqs) {
      lines.push(
        `  ${skill.emoji ?? "skill"} ${skill.name} ${theme.muted(`(${formatSkillMissingSummary(skill)})`)}`,
      );
    }
  }

  return appendClawHubHint(lines.join("\n"), opts.json);
}

export const TEST_LANE_METADATA = [
  {
    file: "src/plugins/loader.test.ts",
    lane: "unit-isolated",
    reason: "plugin loader bootstraps large runtime graphs",
  },
  {
    file: "src/plugins/tools.optional.test.ts",
    lane: "unit-isolated",
    reason: "optional tool discovery is setup-heavy",
  },
  {
    file: "src/agents/session-tool-result-guard.tool-result-persist-hook.test.ts",
    lane: "unit-isolated",
    reason: "session persistence hooks are filesystem-heavy",
  },
  {
    file: "src/security/fix.test.ts",
    lane: "unit-isolated",
    reason: "security fix flows touch many filesystem fixtures",
  },
  {
    file: "src/security/temp-path-guard.test.ts",
    lane: "unit-isolated",
    reason: "runtime source guard scans are sensitive to filesystem contention",
  },
  {
    file: "src/security/audit.test.ts",
    lane: "unit-isolated",
    reason: "security audit cases are setup-heavy and high-variance",
  },
  {
    file: "src/utils.test.ts",
    lane: "unit-isolated",
    reason: "utility fixture coverage is broad and expensive",
  },
  {
    file: "src/auto-reply/tool-meta.test.ts",
    lane: "unit-isolated",
    reason: "tool metadata snapshots are bootstrap-heavy",
  },
  {
    file: "src/auto-reply/envelope.test.ts",
    lane: "unit-isolated",
    reason: "envelope fixtures are broad and setup-heavy",
  },
  {
    file: "src/commands/auth-choice.test.ts",
    lane: "unit-isolated",
    reason: "auth-choice flows pull large config and prompt stacks",
  },
  {
    file: "src/process/supervisor/supervisor.test.ts",
    lane: "unit-isolated",
    reason: "process supervision is stable but setup-heavy",
  },
  {
    file: "src/docker-setup.test.ts",
    lane: "unit-isolated",
    reason: "docker setup is stable but setup-heavy",
  },
  {
    file: "src/agents/skills.build-workspace-skills-prompt.syncs-merged-skills-into-target-workspace.test.ts",
    lane: "unit-isolated",
    reason: "skills sync is filesystem-heavy",
  },
  {
    file: "test/git-hooks-pre-commit.test.ts",
    lane: "unit-isolated",
    reason: "real git hook integration should stay off the fast lane",
  },
  {
    file: "src/commands/doctor.warns-state-directory-is-missing.test.ts",
    lane: "unit-isolated",
    reason: "doctor command setup is expensive",
  },
  {
    file: "src/commands/doctor.warns-per-agent-sandbox-docker-browser-prune.test.ts",
    lane: "unit-isolated",
    reason: "doctor command setup is expensive",
  },
  {
    file: "src/commands/doctor.runs-legacy-state-migrations-yes-mode-without.test.ts",
    lane: "unit-isolated",
    reason: "doctor migration setup is expensive",
  },
  {
    file: "src/cli/update-cli.test.ts",
    lane: "unit-isolated",
    reason: "CLI update flows are setup-heavy",
  },
  {
    file: "src/config/schema.test.ts",
    lane: "unit-isolated",
    reason: "schema build checks are expensive bootstrap coverage",
  },
  {
    file: "src/config/schema.tags.test.ts",
    lane: "unit-isolated",
    reason: "schema tagging checks are expensive bootstrap coverage",
  },
  {
    file: "src/cli/program.smoke.test.ts",
    lane: "unit-isolated",
    reason: "CLI smoke flows are setup-heavy",
  },
  {
    file: "src/commands/agent.test.ts",
    lane: "unit-isolated",
    reason: "agent command flows are setup-heavy",
  },
  {
    file: "src/media/store.test.ts",
    lane: "unit-isolated",
    reason: "media store fixtures are heavy",
  },
  {
    file: "src/media/store.header-ext.test.ts",
    lane: "unit-isolated",
    reason: "media header fixtures are heavy",
  },
  {
    file: "src/web/media.test.ts",
    lane: "unit-isolated",
    reason: "web media flows are setup-heavy",
  },
  {
    file: "src/web/auto-reply.web-auto-reply.falls-back-text-media-send-fails.test.ts",
    lane: "unit-isolated",
    reason: "web auto-reply media fallback is setup-heavy",
  },
  {
    file: "src/browser/server.covers-additional-endpoint-branches.test.ts",
    lane: "unit-isolated",
    reason: "browser server contract coverage is setup-heavy",
  },
  {
    file: "src/browser/server.post-tabs-open-profile-unknown-returns-404.test.ts",
    lane: "unit-isolated",
    reason: "browser server contract coverage is setup-heavy",
  },
  {
    file: "src/browser/server.agent-contract-snapshot-endpoints.test.ts",
    lane: "unit-isolated",
    reason: "browser server contract coverage is setup-heavy",
  },
  {
    file: "src/browser/server.agent-contract-form-layout-act-commands.test.ts",
    lane: "unit-isolated",
    reason: "browser server contract coverage is setup-heavy",
  },
  {
    file: "src/browser/server.skips-default-maxchars-explicitly-set-zero.test.ts",
    lane: "unit-isolated",
    reason: "browser server contract coverage is setup-heavy",
  },
  {
    file: "src/browser/server.auth-token-gates-http.test.ts",
    lane: "unit-isolated",
    reason: "browser server auth coverage is setup-heavy",
  },
  {
    file: "src/auto-reply/reply.block-streaming.test.ts",
    lane: "unit-isolated",
    reason: "block streaming is high-variance under contention",
  },
  {
    file: "src/hooks/install.test.ts",
    lane: "unit-isolated",
    reason: "archive extraction fixtures are heavy",
  },
  {
    file: "src/agents/skills-install.download.test.ts",
    lane: "unit-isolated",
    reason: "download and extraction safety cases spike under contention",
  },
  {
    file: "src/agents/pi-embedded-runner.test.ts",
    lane: "unit-isolated",
    reason: "embedded runner suites contend on shared resources",
  },
  {
    file: "src/agents/bash-tools.test.ts",
    lane: "unit-isolated",
    reason: "exec/archive suites contend on shared resources",
  },
  {
    file: "src/agents/openclaw-tools.subagents.sessions-spawn.lifecycle.test.ts",
    lane: "unit-isolated",
    reason: "subagent lifecycle suites contend on shared resources",
  },
  {
    file: "src/agents/bash-tools.exec.background-abort.test.ts",
    lane: "unit-isolated",
    reason: "background exec suites contend on shared resources",
  },
  {
    file: "src/agents/subagent-announce.format.test.ts",
    lane: "unit-isolated",
    reason: "subagent announce formatting is setup-heavy",
  },
  {
    file: "src/infra/archive.test.ts",
    lane: "unit-isolated",
    reason: "archive fixtures are setup-heavy",
  },
  {
    file: "src/cli/daemon-cli.coverage.test.ts",
    lane: "unit-isolated",
    reason: "daemon coverage is setup-heavy",
  },
  {
    file: "src/agents/models-config.normalizes-gemini-3-ids-preview-google-providers.test.ts",
    lane: "unit-isolated",
    reason: "model normalization imports large config/model discovery stacks",
  },
  {
    file: "src/agents/pi-embedded-runner.run-embedded-pi-agent.auth-profile-rotation.test.ts",
    lane: "unit-isolated",
    reason: "auth profile rotation is retry-heavy and high-variance",
  },
  {
    file: "src/auto-reply/reply.triggers.trigger-handling.filters-usage-summary-current-model-provider.test.ts",
    lane: "unit-isolated",
    reason: "trigger command scenarios are heavy and contention-prone",
  },
  {
    file: "src/auto-reply/reply.triggers.trigger-handling.targets-active-session-native-stop.test.ts",
    lane: "unit-isolated",
    reason: "trigger command scenarios are heavy and contention-prone",
  },
  {
    file: "src/auto-reply/reply.triggers.group-intro-prompts.test.ts",
    lane: "unit-isolated",
    reason: "trigger command scenarios are heavy and contention-prone",
  },
  {
    file: "src/auto-reply/reply.triggers.trigger-handling.handles-inline-commands-strips-it-before-agent.test.ts",
    lane: "unit-isolated",
    reason: "trigger command scenarios are heavy and contention-prone",
  },
  {
    file: "src/web/auto-reply.web-auto-reply.compresses-common-formats-jpeg-cap.test.ts",
    lane: "unit-isolated",
    reason: "web auto-reply media compression is contention-prone",
  },
  {
    file: "src/telegram/bot.create-telegram-bot.test.ts",
    lane: "unit-isolated",
    reason: "Telegram bot bootstrap is setup-heavy",
  },
  {
    file: "src/telegram/bot.test.ts",
    lane: "unit-isolated",
    reason: "Telegram bot behavior is medium-heavy",
  },
  {
    file: "src/slack/monitor/slash.test.ts",
    lane: "unit-isolated",
    reason: "Slack slash registration is setup-heavy",
  },
  {
    file: "src/imessage/monitor.shutdown.unhandled-rejection.test.ts",
    lane: "unit-isolated",
    reason: "process-level rejection listeners should stay isolated",
  },
];

export function collectTestLaneFiles(params) {
  const { lane, existsSync } = params;
  return TEST_LANE_METADATA.filter((entry) => entry.lane === lane && existsSync(entry.file)).map(
    (entry) => entry.file,
  );
}

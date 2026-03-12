---
summary: "CLI reference for `openclaw skills` including audit and trust approval"
read_when:
  - You want to see which skills are available and ready to run
  - You want to debug missing binaries, env, or config for skills
  - You want to audit or approve third-party skills
title: "skills"
---

# `openclaw skills`

Inspect skills (bundled + workspace + managed overrides), see what is eligible vs missing requirements, and audit or approve third-party skills before use.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- ClawHub installs: [ClawHub](/tools/clawhub)

## Commands

```bash
openclaw skills list
openclaw skills list --eligible
openclaw skills info <name>
openclaw skills check
openclaw skills audit [name]
openclaw skills trust approve <name>
openclaw skills trust revoke <name>
```

## Audit and quarantine

OpenClaw audits third-party standalone skills before they are exposed to the model:

- New third-party skills start **quarantined** until you approve the current fingerprint.
- If a trusted skill changes on disk, it is quarantined again until re-approved.
- Bundled skills and plugin-owned skills are not quarantined by this trust gate.
- During upgrade migration, previously installed clean or warn-only third-party skills remain usable, while critical findings or scan failures are quarantined.

The audit output is heuristic, not a guarantee. Review the skill before approving it.

## Common flows

Audit all visible skills:

```bash
openclaw skills audit
```

Audit one skill and inspect its findings:

```bash
openclaw skills audit my-skill
openclaw skills info my-skill
```

Approve a quarantined skill after review:

```bash
openclaw skills trust approve my-skill
```

Revoke trust for the current fingerprint:

```bash
openclaw skills trust revoke my-skill
```

## What the status commands show

- `skills list` includes readiness plus trust or audit state.
- `skills info <name>` shows the trust reason, audit status, findings preview, and the exact approve command when a skill is quarantined.
- `skills check` summarizes ready, quarantined, blocked, disabled, and missing-requirement skills.

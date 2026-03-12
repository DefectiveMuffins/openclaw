---
summary: "macOS Skills settings UI and gateway-backed status"
read_when:
  - Updating the macOS Skills settings UI
  - Changing skills gating, audit, or install behavior
title: "Skills"
---

# Skills (macOS)

The macOS app surfaces OpenClaw skills via the gateway. It does not parse skills locally.

## Data source

- `skills.status` returns all visible skills plus eligibility and missing requirements.
- `skills.status` also returns quarantine state, audit status, audit summary, trust reason, and last scan time for third-party standalone skills.
- Requirements are derived from `metadata.openclaw.requires` in each `SKILL.md`.

## Trust and approval

- New third-party standalone skills appear as **quarantined** until approved.
- The macOS Skills UI shows the audit summary and provides approve/revoke actions.
- If a trusted skill changes on disk, the updated fingerprint is quarantined again until re-approved.
- Bundled skills and plugin-owned skills do not use this quarantine flow.

## Install actions

- `metadata.openclaw.install` defines install options (brew, node, go, uv, or download).
- The app calls `skills.install` to run installers on the gateway host.
- Install results include audit outcome, so a successful install can still leave the skill quarantined pending review.
- The gateway surfaces one preferred installer when multiple are provided, except download-only skills, which can expose multiple artifacts.

## Env and API keys

- The app stores keys in `~/.openclaw/openclaw.json` under `skills.entries.<skillKey>`.
- `skills.update` patches `enabled`, `apiKey`, and `env`.

## Remote mode

- Install, audit, and config updates happen on the gateway host, not the local Mac.

import type { ConfigUiHints } from "../shared/config-ui-hints-types.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";

export type ConfigMetadataEntry = {
  label?: string;
  help?: string;
  placeholder?: string;
  group?: string;
  order?: number;
};

export const GROUP_METADATA: Record<string, ConfigMetadataEntry> = {
  wizard: { label: "Wizard", group: "Wizard", order: 20 },
  update: { label: "Update", group: "Update", order: 25 },
  diagnostics: { label: "Diagnostics", group: "Diagnostics", order: 27 },
  gateway: { label: "Gateway", group: "Gateway", order: 30 },
  nodeHost: { label: "Node Host", group: "Node Host", order: 35 },
  agents: { label: "Agents", group: "Agents", order: 40 },
  tools: { label: "Tools", group: "Tools", order: 50 },
  bindings: { label: "Bindings", group: "Bindings", order: 55 },
  audio: { label: "Audio", group: "Audio", order: 60 },
  models: { label: "Models", group: "Models", order: 70 },
  messages: { label: "Messages", group: "Messages", order: 80 },
  commands: { label: "Commands", group: "Commands", order: 85 },
  session: { label: "Session", group: "Session", order: 90 },
  cron: { label: "Cron", group: "Cron", order: 100 },
  hooks: { label: "Hooks", group: "Hooks", order: 110 },
  ui: { label: "UI", group: "UI", order: 120 },
  browser: { label: "Browser", group: "Browser", order: 130 },
  talk: { label: "Talk", group: "Talk", order: 140 },
  channels: { label: "Messaging Channels", group: "Messaging Channels", order: 150 },
  skills: { label: "Skills", group: "Skills", order: 200 },
  plugins: { label: "Plugins", group: "Plugins", order: 205 },
  discovery: { label: "Discovery", group: "Discovery", order: 210 },
  presence: { label: "Presence", group: "Presence", order: 220 },
  voicewake: { label: "Voice Wake", group: "Voice Wake", order: 230 },
  logging: { label: "Logging", group: "Logging", order: 900 },
};

export const FIELD_PLACEHOLDERS: Record<string, string> = {
  "gateway.remote.url": "ws://host:18789",
  "gateway.remote.tlsFingerprint": "sha256:ab12cd34...",
  "gateway.remote.sshTarget": "user@host",
  "gateway.controlUi.basePath": "/openclaw",
  "gateway.controlUi.root": "dist/control-ui",
  "gateway.controlUi.allowedOrigins": "https://control.example.com",
  "channels.mattermost.baseUrl": "https://chat.example.com",
  "agents.list[].identity.avatar": "avatars/openclaw.png",
};

export function buildConfigMetadata(): Record<string, ConfigMetadataEntry> {
  const metadata: Record<string, ConfigMetadataEntry> = { ...GROUP_METADATA };

  for (const [path, label] of Object.entries(FIELD_LABELS)) {
    metadata[path] = {
      ...metadata[path],
      label,
    };
  }

  for (const [path, help] of Object.entries(FIELD_HELP)) {
    metadata[path] = {
      ...metadata[path],
      help,
    };
  }

  for (const [path, placeholder] of Object.entries(FIELD_PLACEHOLDERS)) {
    metadata[path] = {
      ...metadata[path],
      placeholder,
    };
  }

  return metadata;
}

export const CONFIG_METADATA = buildConfigMetadata();

export function buildConfigMetadataHints(): ConfigUiHints {
  const hints: ConfigUiHints = {};
  for (const [path, entry] of Object.entries(CONFIG_METADATA)) {
    hints[path] = { ...entry };
  }
  return hints;
}

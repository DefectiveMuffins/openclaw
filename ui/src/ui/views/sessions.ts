import { html, nothing } from "lit";
import { formatRelativeTimestamp } from "../format.ts";
import { pathForTab } from "../navigation.ts";
import { formatSessionTokens } from "../presenter.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";

export type SessionsProps = {
  loading: boolean;
  result: SessionsListResult | null;
  error: string | null;
  activeMinutes: string;
  limit: string;
  includeGlobal: boolean;
  includeUnknown: boolean;
  basePath: string;
  onFiltersChange: (next: {
    activeMinutes: string;
    limit: string;
    includeGlobal: boolean;
    includeUnknown: boolean;
  }) => void;
  onRefresh: () => void;
  onPatch: (
    key: string,
    patch: {
      label?: string | null;
      thinkingLevel?: string | null;
      verboseLevel?: string | null;
      reasoningLevel?: string | null;
    },
  ) => void;
  onDelete: (key: string) => void;
};

const THINK_LEVELS = ["", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const BINARY_THINK_LEVELS = ["", "off", "on"] as const;
const VERBOSE_LEVELS = [
  { value: "", label: "inherit" },
  { value: "off", label: "off (explicit)" },
  { value: "on", label: "on" },
  { value: "full", label: "full" },
] as const;
const REASONING_LEVELS = ["", "off", "on", "stream"] as const;

type SessionRowViewModel = {
  row: GatewaySessionRow;
  updated: string;
  isBinaryThinking: boolean;
  thinking: string;
  thinkLevels: string[];
  verbose: string;
  verboseLevels: Array<{ value: string; label: string }>;
  reasoning: string;
  reasoningLevels: string[];
  displayName: string | null;
  label: string;
  showDisplayName: boolean;
  canLink: boolean;
  chatUrl: string | null;
};

function normalizeProviderId(provider?: string | null): string {
  if (!provider) {
    return "";
  }
  const normalized = provider.trim().toLowerCase();
  if (normalized === "z.ai" || normalized === "z-ai") {
    return "zai";
  }
  return normalized;
}

function isBinaryThinkingProvider(provider?: string | null): boolean {
  return normalizeProviderId(provider) === "zai";
}

function resolveThinkLevelOptions(provider?: string | null): readonly string[] {
  return isBinaryThinkingProvider(provider) ? BINARY_THINK_LEVELS : THINK_LEVELS;
}

function withCurrentOption(options: readonly string[], current: string): string[] {
  if (!current) {
    return [...options];
  }
  if (options.includes(current)) {
    return [...options];
  }
  return [...options, current];
}

function withCurrentLabeledOption(
  options: readonly { value: string; label: string }[],
  current: string,
): Array<{ value: string; label: string }> {
  if (!current) {
    return [...options];
  }
  if (options.some((option) => option.value === current)) {
    return [...options];
  }
  return [...options, { value: current, label: `${current} (custom)` }];
}

function resolveThinkLevelDisplay(value: string, isBinary: boolean): string {
  if (!isBinary) {
    return value;
  }
  if (!value || value === "off") {
    return value;
  }
  return "on";
}

function resolveThinkLevelPatchValue(value: string, isBinary: boolean): string | null {
  if (!value) {
    return null;
  }
  if (!isBinary) {
    return value;
  }
  if (value === "on") {
    return "low";
  }
  return value;
}

function buildSessionRowViewModel(row: GatewaySessionRow, basePath: string): SessionRowViewModel {
  const updated = row.updatedAt ? formatRelativeTimestamp(row.updatedAt) : "n/a";
  const rawThinking = row.thinkingLevel ?? "";
  const isBinaryThinking = isBinaryThinkingProvider(row.modelProvider);
  const thinking = resolveThinkLevelDisplay(rawThinking, isBinaryThinking);
  const thinkLevels = withCurrentOption(resolveThinkLevelOptions(row.modelProvider), thinking);
  const verbose = row.verboseLevel ?? "";
  const verboseLevels = withCurrentLabeledOption(VERBOSE_LEVELS, verbose);
  const reasoning = row.reasoningLevel ?? "";
  const reasoningLevels = withCurrentOption(REASONING_LEVELS, reasoning);
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim().length > 0
      ? row.displayName.trim()
      : null;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const showDisplayName = Boolean(displayName && displayName !== row.key && displayName !== label);
  const canLink = row.kind !== "global";
  const chatUrl = canLink
    ? `${pathForTab("chat", basePath)}?session=${encodeURIComponent(row.key)}`
    : null;

  return {
    row,
    updated,
    isBinaryThinking,
    thinking,
    thinkLevels,
    verbose,
    verboseLevels,
    reasoning,
    reasoningLevels,
    displayName,
    label,
    showDisplayName,
    canLink,
    chatUrl,
  };
}

function renderThinkingSelect(
  view: SessionRowViewModel,
  onPatch: SessionsProps["onPatch"],
  disabled: boolean,
) {
  return html`
    <select
      ?disabled=${disabled}
      @change=${(e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        onPatch(view.row.key, {
          thinkingLevel: resolveThinkLevelPatchValue(value, view.isBinaryThinking),
        });
      }}
    >
      ${view.thinkLevels.map(
        (level) => html`<option value=${level} ?selected=${view.thinking === level}>
          ${level || "inherit"}
        </option>`,
      )}
    </select>
  `;
}

function renderVerboseSelect(
  view: SessionRowViewModel,
  onPatch: SessionsProps["onPatch"],
  disabled: boolean,
) {
  return html`
    <select
      ?disabled=${disabled}
      @change=${(e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        onPatch(view.row.key, { verboseLevel: value || null });
      }}
    >
      ${view.verboseLevels.map(
        (level) => html`<option value=${level.value} ?selected=${view.verbose === level.value}>
          ${level.label}
        </option>`,
      )}
    </select>
  `;
}

function renderReasoningSelect(
  view: SessionRowViewModel,
  onPatch: SessionsProps["onPatch"],
  disabled: boolean,
) {
  return html`
    <select
      ?disabled=${disabled}
      @change=${(e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        onPatch(view.row.key, { reasoningLevel: value || null });
      }}
    >
      ${view.reasoningLevels.map(
        (level) => html`<option value=${level} ?selected=${view.reasoning === level}>
          ${level || "inherit"}
        </option>`,
      )}
    </select>
  `;
}

function renderLabelInput(
  view: SessionRowViewModel,
  onPatch: SessionsProps["onPatch"],
  disabled: boolean,
) {
  return html`
    <input
      .value=${view.row.label ?? ""}
      ?disabled=${disabled}
      placeholder="(optional)"
      @change=${(e: Event) => {
        const value = (e.target as HTMLInputElement).value.trim();
        onPatch(view.row.key, { label: value || null });
      }}
    />
  `;
}

function renderSessionActions(
  view: SessionRowViewModel,
  onDelete: SessionsProps["onDelete"],
  disabled: boolean,
) {
  return html`
    <div class="session-actions">
      ${view.chatUrl ? html`<a class="btn btn--sm" href=${view.chatUrl}>Open chat</a>` : nothing}
      <button class="btn btn--sm danger" ?disabled=${disabled} @click=${() => onDelete(view.row.key)}>
        Delete
      </button>
    </div>
  `;
}

function renderDesktopRow(
  row: GatewaySessionRow,
  basePath: string,
  onPatch: SessionsProps["onPatch"],
  onDelete: SessionsProps["onDelete"],
  disabled: boolean,
) {
  const view = buildSessionRowViewModel(row, basePath);
  return html`
    <div class="table-row session-table-row">
      <div class="mono session-key-cell">
        ${view.chatUrl ? html`<a href=${view.chatUrl} class="session-link">${row.key}</a>` : row.key}
        ${view.showDisplayName ? html`<span class="muted session-key-display-name">${view.displayName}</span>` : nothing}
      </div>
      <div>${renderLabelInput(view, onPatch, disabled)}</div>
      <div>${row.kind}</div>
      <div>${view.updated}</div>
      <div>${formatSessionTokens(row)}</div>
      <div>${renderThinkingSelect(view, onPatch, disabled)}</div>
      <div>${renderVerboseSelect(view, onPatch, disabled)}</div>
      <div>${renderReasoningSelect(view, onPatch, disabled)}</div>
      <div>${renderSessionActions(view, onDelete, disabled)}</div>
    </div>
  `;
}

function renderMobileRow(
  row: GatewaySessionRow,
  basePath: string,
  onPatch: SessionsProps["onPatch"],
  onDelete: SessionsProps["onDelete"],
  disabled: boolean,
) {
  const view = buildSessionRowViewModel(row, basePath);
  return html`
    <article class="session-card">
      <div class="session-card__header">
        <div class="session-card__title-wrap">
          <div class="mono session-card__title">
            ${view.chatUrl ? html`<a href=${view.chatUrl} class="session-link">${row.key}</a>` : row.key}
          </div>
          ${view.showDisplayName ? html`<div class="muted session-card__display-name">${view.displayName}</div>` : nothing}
        </div>
        <div class="chip-row session-card__chips">
          <span class="chip">${row.kind}</span>
          <span class="chip">${view.updated}</span>
          <span class="chip">${formatSessionTokens(row)}</span>
        </div>
      </div>
      <div class="session-card__fields">
        <label class="field">
          <span>Label</span>
          ${renderLabelInput(view, onPatch, disabled)}
        </label>
        <label class="field">
          <span>Thinking</span>
          ${renderThinkingSelect(view, onPatch, disabled)}
        </label>
        <label class="field">
          <span>Verbose</span>
          ${renderVerboseSelect(view, onPatch, disabled)}
        </label>
        <label class="field">
          <span>Reasoning</span>
          ${renderReasoningSelect(view, onPatch, disabled)}
        </label>
      </div>
      ${renderSessionActions(view, onDelete, disabled)}
    </article>
  `;
}

export function renderSessions(props: SessionsProps) {
  const rows = props.result?.sessions ?? [];
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Sessions</div>
          <div class="card-sub">Active session keys and per-session overrides.</div>
        </div>
        <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
          ${props.loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div class="filters" style="margin-top: 14px;">
        <label class="field">
          <span>Active within (minutes)</span>
          <input
            .value=${props.activeMinutes}
            @input=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: (e.target as HTMLInputElement).value,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field">
          <span>Limit</span>
          <input
            .value=${props.limit}
            @input=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: (e.target as HTMLInputElement).value,
                includeGlobal: props.includeGlobal,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>Include global</span>
          <input
            type="checkbox"
            .checked=${props.includeGlobal}
            @change=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: (e.target as HTMLInputElement).checked,
                includeUnknown: props.includeUnknown,
              })}
          />
        </label>
        <label class="field checkbox">
          <span>Include unknown</span>
          <input
            type="checkbox"
            .checked=${props.includeUnknown}
            @change=${(e: Event) =>
              props.onFiltersChange({
                activeMinutes: props.activeMinutes,
                limit: props.limit,
                includeGlobal: props.includeGlobal,
                includeUnknown: (e.target as HTMLInputElement).checked,
              })}
          />
        </label>
      </div>

      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
          : nothing
      }

      <div class="muted" style="margin-top: 12px;">
        ${props.result ? `Store: ${props.result.path}` : ""}
      </div>

      <div class="sessions-table sessions-table--desktop" style="margin-top: 16px;">
        <div class="table-head session-table-head">
          <div>Key</div>
          <div>Label</div>
          <div>Kind</div>
          <div>Updated</div>
          <div>Tokens</div>
          <div>Thinking</div>
          <div>Verbose</div>
          <div>Reasoning</div>
          <div>Actions</div>
        </div>
        ${
          rows.length === 0
            ? html`
                <div class="muted">No sessions found.</div>
              `
            : rows.map((row) =>
                renderDesktopRow(row, props.basePath, props.onPatch, props.onDelete, props.loading),
              )
        }
      </div>

      <div class="sessions-mobile-list" style="margin-top: 16px;">
        ${
          rows.length === 0
            ? html`
                <div class="muted">No sessions found.</div>
              `
            : rows.map((row) =>
                renderMobileRow(row, props.basePath, props.onPatch, props.onDelete, props.loading),
              )
        }
      </div>
    </section>
  `;
}

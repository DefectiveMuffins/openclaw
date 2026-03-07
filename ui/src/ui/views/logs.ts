import { html, nothing } from "lit";
import type { LogEntry, LogLevel } from "../types.ts";

const LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

export type LogsProps = {
  loading: boolean;
  error: string | null;
  file: string | null;
  entries: LogEntry[];
  filterText: string;
  levelFilters: Record<LogLevel, boolean>;
  autoFollow: boolean;
  truncated: boolean;
  onFilterTextChange: (next: string) => void;
  onLevelToggle: (level: LogLevel, enabled: boolean) => void;
  onToggleAutoFollow: (next: boolean) => void;
  onRefresh: () => void;
  onExport: (lines: string[], label: string) => void;
  onScroll: (event: Event) => void;
};

function formatTime(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString();
}

function matchesFilter(entry: LogEntry, needle: string) {
  if (!needle) {
    return true;
  }
  const haystack = [entry.message, entry.subsystem, entry.raw]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function renderLogs(props: LogsProps) {
  const needle = props.filterText.trim().toLowerCase();
  const levelFiltered = LEVELS.some((level) => !props.levelFilters[level]);
  const filtered = props.entries.filter((entry) => {
    if (entry.level && !props.levelFilters[entry.level]) {
      return false;
    }
    return matchesFilter(entry, needle);
  });
  const exportLabel = needle || levelFiltered ? "filtered" : "visible";
  const summaryText =
    props.entries.length === 0
      ? "Waiting for log output."
      : filtered.length === props.entries.length
        ? `Showing ${filtered.length} entries.`
        : `Showing ${filtered.length} of ${props.entries.length} entries.`;
  const emptyText =
    props.entries.length === 0
      ? "No log entries yet."
      : "No log entries match the current filters.";

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div>
          <div class="card-title">Logs</div>
          <div class="card-sub">Gateway file logs (JSONL).</div>
        </div>
        <div class="row" style="gap: 8px; flex-wrap: wrap;">
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading..." : "Refresh"}
          </button>
          <button
            class="btn"
            ?disabled=${filtered.length === 0}
            @click=${() =>
              props.onExport(
                filtered.map((entry) => entry.raw),
                exportLabel,
              )}
          >
            Export ${exportLabel}
          </button>
        </div>
      </div>

      <div class="filters logs-filters" style="margin-top: 14px;">
        <label class="field logs-filter-search">
          <span>Filter</span>
          <input
            .value=${props.filterText}
            @input=${(e: Event) => props.onFilterTextChange((e.target as HTMLInputElement).value)}
            placeholder="Search logs"
          />
        </label>
        <label class="field checkbox logs-autofollow-toggle">
          <span>Auto-follow</span>
          <input
            type="checkbox"
            .checked=${props.autoFollow}
            @change=${(e: Event) =>
              props.onToggleAutoFollow((e.target as HTMLInputElement).checked)}
          />
        </label>
      </div>

      <div class="chip-row logs-level-row" style="margin-top: 12px;">
        ${LEVELS.map(
          (level) => html`
            <label class="chip log-chip ${level}">
              <input
                type="checkbox"
                .checked=${props.levelFilters[level]}
                @change=${(e: Event) =>
                  props.onLevelToggle(level, (e.target as HTMLInputElement).checked)}
              />
              <span>${level}</span>
            </label>
          `,
        )}
      </div>

      <div class="callout info logs-summary" style="margin-top: 12px;">
        <div>${summaryText}</div>
        ${props.file ? html`<div class="muted" style="margin-top: 6px;">File: ${props.file}</div>` : nothing}
      </div>

      ${
        props.truncated
          ? html`
              <div class="callout" style="margin-top: 10px">Log output truncated; the latest chunk is shown.</div>
            `
          : nothing
      }
      ${
        props.error
          ? html`<div class="callout danger" style="margin-top: 10px;">${props.error}</div>`
          : nothing
      }

      <div class="log-stream" style="margin-top: 12px;" @scroll=${props.onScroll}>
        ${
          filtered.length === 0
            ? html`<div class="muted" style="padding: 12px">${emptyText}</div>`
            : filtered.map(
                (entry) => html`
                  <article class="log-row">
                    <div class="log-row__meta">
                      <div class="log-time mono">${formatTime(entry.time)}</div>
                      ${
                        entry.level
                          ? html`<div class="log-level ${entry.level}">${entry.level}</div>`
                          : nothing
                      }
                      ${
                        entry.subsystem
                          ? html`<div class="log-subsystem mono">${entry.subsystem}</div>`
                          : nothing
                      }
                    </div>
                    <div class="log-message mono">${entry.message ?? entry.raw}</div>
                  </article>
                `,
              )
        }
      </div>
    </section>
  `;
}

import { html, nothing } from "lit";
import { buildAgentMainSessionKey } from "../../../../src/routing/session-key.js";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  GatewayModelChoice,
  HostedProviderStatus,
  ModelsHostedProvidersResult,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../types.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import {
  agentBadgeText,
  buildAgentContext,
  buildModelOptions,
  formatHostedProviderSkipReasons,
  formatHostedProviderStatus,
  isHostedProviderSelected,
  normalizeAgentLabel,
  normalizeModelValue,
  orderHostedProviders,
  parseFallbackList,
  resolveAgentConfig,
  resolveAgentEmoji,
  resolveAgentOptimizationSummary,
  resolveEffectiveModelFallbacks,
  resolveHostedRoutingAppendConfiguredModels,
  resolveHostedRoutingProviderOrder,
  resolveHostedRoutingUiMode,
  resolveModelLabel,
  resolveModelPrimary,
  type HostedRoutingUiMode,
} from "./agents-utils.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentsProps = {
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  basePath: string;
  configForm: Record<string, unknown> | null;
  modelChoices: GatewayModelChoice[];
  modelDiscoveryLoading: boolean;
  modelDiscoveryError: string | null;
  modelDiscoveryImportedCount: number | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  hostedProvidersLoading: boolean;
  hostedProvidersError: string | null;
  hostedProvidersResult: ModelsHostedProvidersResult | null;
  hostedProvidersNotice: string | null;
  hostedProviderAuthBusy: boolean;
  skillsFilter: string;
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onDiscoverLmStudioModels: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onHostedRoutingModeChange: (mode: HostedRoutingUiMode) => void;
  onHostedRoutingAppendConfiguredModelsChange: (enabled: boolean) => void;
  onHostedRoutingProviderToggle: (providerId: string, enabled: boolean) => void;
  onHostedRoutingProviderMove: (providerId: string, direction: "up" | "down") => void;
  onHostedProvidersRefresh: () => void;
  onHostedProviderAuth: (providerId: string) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
};

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

function buildTabHref(basePath: string, tab: "chat" | "sessions" | "config"): string {
  const normalized =
    basePath && basePath !== "/" ? (basePath.endsWith("/") ? basePath.slice(0, -1) : basePath) : "";
  return `${normalized}/${tab}`;
}

type HostedProviderManagerParams = {
  defaults: ReturnType<typeof resolveAgentConfig>["defaults"];
  hostedRoutingMode: HostedRoutingUiMode;
  hostedProvidersLoading: boolean;
  hostedProvidersError: string | null;
  hostedProvidersResult: ModelsHostedProvidersResult | null;
  hostedProvidersNotice: string | null;
  hostedProviderAuthBusy: boolean;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onHostedRoutingAppendConfiguredModelsChange: (enabled: boolean) => void;
  onHostedRoutingProviderToggle: (providerId: string, enabled: boolean) => void;
  onHostedRoutingProviderMove: (providerId: string, direction: "up" | "down") => void;
  onHostedProvidersRefresh: () => void;
  onHostedProviderAuth: (providerId: string) => void;
};

function renderHostedProviderRow(params: {
  provider: HostedProviderStatus;
  selected: boolean;
  selectedIndex: number;
  selectedCount: number;
  controlsDisabled: boolean;
  authDisabled: boolean;
  onHostedRoutingProviderToggle: (providerId: string, enabled: boolean) => void;
  onHostedRoutingProviderMove: (providerId: string, direction: "up" | "down") => void;
  onHostedProviderAuth: (providerId: string) => void;
}) {
  const { provider, selected, selectedIndex, selectedCount, controlsDisabled, authDisabled } = params;
  const authLabel = provider.skipReasons.includes("no auth") ? "Connect" : "Configure";
  return html`
    <div class="hosted-provider-row ${selected ? "active" : ""}">
      <label class="hosted-provider-main">
        <input
          type="checkbox"
          .checked=${selected}
          ?disabled=${controlsDisabled}
          @change=${(event: Event) =>
            params.onHostedRoutingProviderToggle(
              provider.provider,
              (event.target as HTMLInputElement).checked,
            )}
        />
        <div class="hosted-provider-copy">
          <div class="hosted-provider-title-row">
            <div class="hosted-provider-title">${provider.label}</div>
            ${provider.optInOnly ? html`<span class="agent-pill">opt-in</span>` : nothing}
            <span class="pill ${provider.available ? "" : "danger"}">${formatHostedProviderStatus(provider)}</span>
          </div>
          <div class="agent-kv-sub muted">
            <span class="mono">${provider.modelRef}</span> | ${provider.authMode} | ${provider.riskLabel}
          </div>
          <div class="agent-kv-sub muted">${formatHostedProviderSkipReasons(provider)}</div>
        </div>
      </label>
      <div class="hosted-provider-actions">
        <button
          class="btn btn--sm"
          ?disabled=${authDisabled}
          @click=${() => params.onHostedProviderAuth(provider.provider)}
        >
          ${authLabel}
        </button>
        <a
          class="btn btn--sm"
          href=${provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Docs
        </a>
        <button
          class="btn btn--sm"
          ?disabled=${controlsDisabled || !selected || selectedIndex === 0}
          @click=${() => params.onHostedRoutingProviderMove(provider.provider, "up")}
        >
          Up
        </button>
        <button
          class="btn btn--sm"
          ?disabled=${controlsDisabled || !selected || selectedIndex === selectedCount - 1}
          @click=${() => params.onHostedRoutingProviderMove(provider.provider, "down")}
        >
          Down
        </button>
      </div>
    </div>
  `;
}

function renderHostedProviderManager(params: HostedProviderManagerParams) {
  const providerOrder = resolveHostedRoutingProviderOrder(params.defaults, params.hostedProvidersResult);
  const providers = orderHostedProviders(params.defaults, params.hostedProvidersResult);
  const selectedProviders = providers.filter((provider) =>
    isHostedProviderSelected(provider.provider, params.defaults, params.hostedProvidersResult),
  );
  const appendConfiguredModels = resolveHostedRoutingAppendConfiguredModels(
    params.defaults,
    params.hostedProvidersResult,
  );
  const controlsDisabled = params.configLoading || params.configSaving;
  const authDisabled = controlsDisabled || params.configDirty || params.hostedProviderAuthBusy;
  const summary =
    selectedProviders.length > 0
      ? selectedProviders.map((provider) => provider.label).join(" -> ")
      : "No hosted providers selected.";

  return html`
    <div style="margin-top: 16px;">
      <div class="hosted-provider-summary">
        <div>
          <div class="label">Hosted provider order</div>
          <div class="card-sub" style="margin-top: 4px;">${summary}</div>
        </div>
        <button
          class="btn btn--sm"
          ?disabled=${params.hostedProvidersLoading}
          @click=${params.onHostedProvidersRefresh}
        >
          ${params.hostedProvidersLoading ? "Refreshing..." : "Refresh providers"}
        </button>
      </div>
      <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px; align-items: center;">
        <label class="hosted-provider-checkbox-row">
          <input
            type="checkbox"
            .checked=${appendConfiguredModels}
            ?disabled=${controlsDisabled}
            @change=${(event: Event) =>
              params.onHostedRoutingAppendConfiguredModelsChange(
                (event.target as HTMLInputElement).checked,
              )}
          />
          <span>Append configured primary and fallbacks after hosted providers</span>
        </label>
        <div class="agent-kv-sub muted">
          ${
            params.hostedRoutingMode === "off"
              ? "Manual primary and fallback models are used directly."
              : appendConfiguredModels
                ? "Hosted providers run first, then your configured model stack."
                : "Hosted providers run alone unless you switch modes or enable configured fallbacks."
          }
        </div>
      </div>
      ${
        params.configDirty
          ? html`<div class="callout danger" style="margin-top: 12px;">
              Save or reload config before changing provider login.
            </div>`
          : nothing
      }
      ${
        params.hostedProvidersError
          ? html`<div class="callout danger" style="margin-top: 12px;">${params.hostedProvidersError}</div>`
          : nothing
      }
      ${
        params.hostedProvidersNotice
          ? html`<div class="callout" style="margin-top: 12px;">${params.hostedProvidersNotice}</div>`
          : nothing
      }
      <div class="hosted-provider-list" style="margin-top: 12px;">
        ${
          providers.length === 0
            ? html`<div class="muted">No hosted providers detected yet.</div>`
            : providers.map((provider) => {
                const selected = selectedProviders.some((entry) => entry.provider === provider.provider);
                const selectedIndex = providerOrder.indexOf(provider.provider);
                return renderHostedProviderRow({
                  provider,
                  selected,
                  selectedIndex,
                  selectedCount: selectedProviders.length,
                  controlsDisabled,
                  authDisabled,
                  onHostedRoutingProviderToggle: params.onHostedRoutingProviderToggle,
                  onHostedRoutingProviderMove: params.onHostedRoutingProviderMove,
                  onHostedProviderAuth: params.onHostedProviderAuth,
                });
              })
        }
      </div>
    </div>
  `;
}

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;

  return html`
    <div class="agents-layout">
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length} configured.</div>
          </div>
          <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Loading..." : "Refresh"}
          </button>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        <div class="agent-list" style="margin-top: 12px;">
          ${
            agents.length === 0
              ? html`
                  <div class="muted">No agents found.</div>
                `
              : agents.map((agent) => {
                  const badge = agentBadgeText(agent.id, defaultId);
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  return html`
                    <button
                      type="button"
                      class="agent-row ${selectedId === agent.id ? "active" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-avatar">${emoji || normalizeAgentLabel(agent).slice(0, 1)}</div>
                      <div class="agent-info">
                        <div class="agent-title">${normalizeAgentLabel(agent)}</div>
                        <div class="agent-sub mono">${agent.id}</div>
                      </div>
                      ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
                    </button>
                  `;
                })
          }
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : html`
                ${renderAgentHeader(
                  selectedAgent,
                  defaultId,
                  props.agentIdentityById[selectedAgent.id] ?? null,
                  props.basePath,
                )}
                ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
                ${
                  props.activePanel === "overview"
                    ? renderAgentOverview({
                        agent: selectedAgent,
                        defaultId,
                        configForm: props.configForm,
                        modelChoices: props.modelChoices,
                        modelDiscoveryLoading: props.modelDiscoveryLoading,
                        modelDiscoveryError: props.modelDiscoveryError,
                        modelDiscoveryImportedCount: props.modelDiscoveryImportedCount,
                        agentFilesList: props.agentFilesList,
                        agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                        agentIdentityError: props.agentIdentityError,
                        agentIdentityLoading: props.agentIdentityLoading,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        hostedProvidersLoading: props.hostedProvidersLoading,
                        hostedProvidersError: props.hostedProvidersError,
                        hostedProvidersResult: props.hostedProvidersResult,
                        hostedProvidersNotice: props.hostedProvidersNotice,
                        hostedProviderAuthBusy: props.hostedProviderAuthBusy,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                        onDiscoverLmStudioModels: props.onDiscoverLmStudioModels,
                        onModelChange: props.onModelChange,
                        onModelFallbacksChange: props.onModelFallbacksChange,
                        onHostedRoutingModeChange: props.onHostedRoutingModeChange,
                        onHostedRoutingAppendConfiguredModelsChange:
                          props.onHostedRoutingAppendConfiguredModelsChange,
                        onHostedRoutingProviderToggle: props.onHostedRoutingProviderToggle,
                        onHostedRoutingProviderMove: props.onHostedRoutingProviderMove,
                        onHostedProvidersRefresh: props.onHostedProvidersRefresh,
                        onHostedProviderAuth: props.onHostedProviderAuth,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "files"
                    ? renderAgentFiles({
                        agentId: selectedAgent.id,
                        agentFilesList: props.agentFilesList,
                        agentFilesLoading: props.agentFilesLoading,
                        agentFilesError: props.agentFilesError,
                        agentFileActive: props.agentFileActive,
                        agentFileContents: props.agentFileContents,
                        agentFileDrafts: props.agentFileDrafts,
                        agentFileSaving: props.agentFileSaving,
                        onLoadFiles: props.onLoadFiles,
                        onSelectFile: props.onSelectFile,
                        onFileDraftChange: props.onFileDraftChange,
                        onFileReset: props.onFileReset,
                        onFileSave: props.onFileSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "tools"
                    ? renderAgentTools({
                        agentId: selectedAgent.id,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        toolsCatalogLoading: props.toolsCatalogLoading,
                        toolsCatalogError: props.toolsCatalogError,
                        toolsCatalogResult: props.toolsCatalogResult,
                        onProfileChange: props.onToolsProfileChange,
                        onOverridesChange: props.onToolsOverridesChange,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "skills"
                    ? renderAgentSkills({
                        agentId: selectedAgent.id,
                        report: props.agentSkillsReport,
                        loading: props.agentSkillsLoading,
                        error: props.agentSkillsError,
                        activeAgentId: props.agentSkillsAgentId,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        filter: props.skillsFilter,
                        onFilterChange: props.onSkillsFilterChange,
                        onRefresh: props.onSkillsRefresh,
                        onToggle: props.onAgentSkillToggle,
                        onClear: props.onAgentSkillsClear,
                        onDisableAll: props.onAgentSkillsDisableAll,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "channels"
                    ? renderAgentChannels({
                        context: buildAgentContext(
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
                        ),
                        configForm: props.configForm,
                        snapshot: props.channelsSnapshot,
                        loading: props.channelsLoading,
                        error: props.channelsError,
                        lastSuccess: props.channelsLastSuccess,
                        onRefresh: props.onChannelsRefresh,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "cron"
                    ? renderAgentCron({
                        context: buildAgentContext(
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
                        ),
                        agentId: selectedAgent.id,
                        jobs: props.cronJobs,
                        status: props.cronStatus,
                        loading: props.cronLoading,
                        error: props.cronError,
                        onRefresh: props.onCronRefresh,
                      })
                    : nothing
                }
              `
        }
      </section>
    </div>
  `;
}

function renderAgentHeader(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  basePath: string,
) {
  const badge = agentBadgeText(agent.id, defaultId);
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  const chatSessionKey = buildAgentMainSessionKey({ agentId: agent.id });
  const chatUrl = `${buildTabHref(basePath, "chat")}?session=${encodeURIComponent(chatSessionKey)}`;
  const sessionsUrl = buildTabHref(basePath, "sessions");
  const configUrl = buildTabHref(basePath, "config");
  return html`
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">${emoji || displayName.slice(0, 1)}</div>
        <div>
          <div class="card-title">${displayName}</div>
          <div class="card-sub">${subtitle}</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
        <div class="agent-header-actions">
          <a class="btn btn--sm" href=${chatUrl}>Open chat</a>
          <a class="btn btn--sm" href=${sessionsUrl}>Sessions</a>
          <a class="btn btn--sm" href=${configUrl}>Config</a>
        </div>
      </div>
    </section>
  `;
}

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  modelChoices: GatewayModelChoice[];
  modelDiscoveryLoading: boolean;
  modelDiscoveryError: string | null;
  modelDiscoveryImportedCount: number | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  hostedProvidersLoading: boolean;
  hostedProvidersError: string | null;
  hostedProvidersResult: ModelsHostedProvidersResult | null;
  hostedProvidersNotice: string | null;
  hostedProviderAuthBusy: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onDiscoverLmStudioModels: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onHostedRoutingModeChange: (mode: HostedRoutingUiMode) => void;
  onHostedRoutingAppendConfiguredModelsChange: (enabled: boolean) => void;
  onHostedRoutingProviderToggle: (providerId: string, enabled: boolean) => void;
  onHostedRoutingProviderMove: (providerId: string, direction: "up" | "down") => void;
  onHostedProvidersRefresh: () => void;
  onHostedProviderAuth: (providerId: string) => void;
}) {
  const {
    agent,
    defaultId,
    configForm,
    modelChoices,
    modelDiscoveryLoading,
    modelDiscoveryError,
    modelDiscoveryImportedCount,
    agentFilesList,
    agentIdentity,
    agentIdentityLoading,
    agentIdentityError,
    configLoading,
    configSaving,
    configDirty,
    hostedProvidersLoading,
    hostedProvidersError,
    hostedProvidersResult,
    hostedProvidersNotice,
    hostedProviderAuthBusy,
    onConfigReload,
    onConfigSave,
    onDiscoverLmStudioModels,
    onModelChange,
    onModelFallbacksChange,
    onHostedRoutingModeChange,
    onHostedRoutingAppendConfiguredModelsChange,
    onHostedRoutingProviderToggle,
    onHostedRoutingProviderMove,
    onHostedProvidersRefresh,
    onHostedProviderAuth,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const modelPrimary =
    resolveModelPrimary(config.entry?.model) || (model !== "-" ? normalizeModelValue(model) : null);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = modelPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveEffectiveModelFallbacks(
    config.entry?.model,
    config.defaults?.model,
  );
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const identityStatus = agentIdentityLoading
    ? "Loading..."
    : agentIdentityError
      ? "Unavailable"
      : "";
  const isDefault = Boolean(defaultId && agent.id === defaultId);
  const hostedRoutingMode = resolveHostedRoutingUiMode(config.defaults);
  const optimization = resolveAgentOptimizationSummary(configForm, agent.id);

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths, identity metadata, and agentic tuning.</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${identityName}</div>
          ${identityStatus ? html`<div class="agent-kv-sub muted">${identityStatus}</div>` : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${isDefault ? "yes" : "no"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${effectivePrimary ?? ""}
              ?disabled=${!configForm || configLoading || configSaving}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                      </option>
                    `
              }
              ${buildModelOptions(configForm, effectivePrimary ?? undefined, modelChoices)}
            </select>
          </label>
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${!configForm || configLoading || configSaving}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
        </div>
        ${
          isDefault
            ? html`
                <div style="margin-top: 16px;">
                  <div class="label">Hosted Provider Rotation</div>
                  <div class="card-sub" style="margin-top: 4px;">
                    Off by default. When enabled, authenticated hosted providers are tried before the configured model. Explicit session overrides still win.
                  </div>
                  <div class="row" style="gap: 12px; flex-wrap: wrap; margin-top: 12px;">
                    <label class="field" style="min-width: 260px; flex: 1;">
                      <span>Routing mode</span>
                      <select
                        .value=${hostedRoutingMode}
                        ?disabled=${!configForm || configLoading || configSaving}
                        @change=${(e: Event) =>
                          onHostedRoutingModeChange(
                            (e.target as HTMLSelectElement).value as HostedRoutingUiMode,
                          )}
                      >
                        <option value="off">Off (manual/API/local default)</option>
                        <option value="prefer-hosted">Prefer hosted, then configured model</option>
                        <option value="hosted-only">Hosted only</option>
                      </select>
                    </label>
                  </div>
                  ${renderHostedProviderManager({
                    defaults: config.defaults,
                    hostedRoutingMode,
                    hostedProvidersLoading,
                    hostedProvidersError,
                    hostedProvidersResult,
                    hostedProvidersNotice,
                    hostedProviderAuthBusy,
                    configLoading,
                    configSaving,
                    configDirty,
                    onHostedRoutingAppendConfiguredModelsChange,
                    onHostedRoutingProviderToggle,
                    onHostedRoutingProviderMove,
                    onHostedProvidersRefresh,
                    onHostedProviderAuth,
                  })}
                </div>
              `
            : nothing
        }
        <div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px;">
          <div>
            ${
              typeof modelDiscoveryImportedCount === "number"
                ? html`<div class="muted">Imported ${modelDiscoveryImportedCount} LM Studio models into the config draft. Save to persist.</div>`
                : nothing
            }
            ${
              modelDiscoveryError
                ? html`<div class="callout danger" style="margin-top: 8px;">${modelDiscoveryError}</div>`
                : nothing
            }
          </div>
          <div class="row" style="justify-content: flex-end; gap: 8px;">
            <button
              class="btn btn--sm"
              ?disabled=${!configForm || configLoading || configSaving || modelDiscoveryLoading}
              @click=${onDiscoverLmStudioModels}
            >
              ${modelDiscoveryLoading ? "Syncing..." : "Sync LM Studio"}
            </button>
            <button class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
              Reload Config
            </button>
            <button
              class="btn btn--sm primary"
              ?disabled=${configSaving || !configDirty}
              @click=${onConfigSave}
            >
              ${configSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div style="margin-top: 24px;">
        <div class="label">RAG and Delegation</div>
        <div class="card-sub" style="margin-top: 4px;">
          Effective staged retrieval, cheap-model routing, and subagent orchestration defaults.
        </div>
        <div class="agents-overview-grid" style="margin-top: 16px;">
          <div class="agent-kv">
            <div class="label">Memory Search</div>
            <div>
              ${optimization.memorySearch.enabled ? "on" : "off"}
              ${
                optimization.memorySearch.provider
                  ? html`<span class="mono"> | ${optimization.memorySearch.provider}</span>`
                  : nothing
              }
            </div>
            <div class="agent-kv-sub muted">
              ${
                optimization.memorySearch.routingEnabled
                  ? `routing | ${optimization.memorySearch.maxQueries ?? 3} queries`
                  : "single-query"
              }
            </div>
          </div>
          <div class="agent-kv">
            <div class="label">Working Set</div>
            <div>${optimization.memorySearch.workingSetEnabled ? "enabled" : "disabled"}</div>
            <div class="agent-kv-sub muted">${formatWorkingSetSummary(optimization)}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Cheap-Stage Routing</div>
            <div>${optimization.modelRouting.enabled ? "enabled" : "disabled"}</div>
            <div class="agent-kv-sub muted">${formatModelRoutingSummary(optimization)}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Escalation</div>
            <div>${formatEscalationSummary(optimization)}</div>
            <div class="agent-kv-sub muted">
              verification
              ${
                optimization.modelRouting.verificationModel
                  ? html` <span class="mono">${optimization.modelRouting.verificationModel}</span>`
                  : " inherits primary model"
              }
            </div>
          </div>
          <div class="agent-kv">
            <div class="label">Thinking and Skills</div>
            <div>${optimization.thinkingDefault}</div>
            <div class="agent-kv-sub muted">skills ${optimization.skillsPromptMode}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Subagent Defaults</div>
            <div>${optimization.subagents.delegationEnabled ? "structured delegation" : "freeform delegation"}</div>
            <div class="agent-kv-sub muted">${formatSubagentSummary(optimization)}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function formatDurationMs(ms?: number): string {
  if (!(typeof ms === "number") || !Number.isFinite(ms) || ms <= 0) {
    return "default";
  }
  if (ms >= 3_600_000) {
    return `${Math.round(ms / 3_600_000)}h`;
  }
  if (ms >= 60_000) {
    return `${Math.round(ms / 60_000)}m`;
  }
  if (ms >= 1_000) {
    return `${Math.round(ms / 1_000)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function formatWorkingSetSummary(
  optimization: import("./agents-utils.ts").AgentOptimizationSummary,
): string {
  const sources =
    optimization.memorySearch.workingSetSources.length > 0
      ? optimization.memorySearch.workingSetSources.join(", ")
      : "toolResults, subagentReports";
  return `${sources} | TTL ${formatDurationMs(optimization.memorySearch.workingSetTtlMs)}`;
}

function formatModelRoutingSummary(
  optimization: import("./agents-utils.ts").AgentOptimizationSummary,
): string {
  const parts = [
    optimization.modelRouting.plannerModel
      ? `planner ${optimization.modelRouting.plannerModel}`
      : null,
    optimization.modelRouting.retrievalModel
      ? `retrieve ${optimization.modelRouting.retrievalModel}`
      : null,
    optimization.modelRouting.compressionModel
      ? `compress ${optimization.modelRouting.compressionModel}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "uses primary model";
}

function formatEscalationSummary(
  optimization: import("./agents-utils.ts").AgentOptimizationSummary,
): string {
  const confidence = optimization.modelRouting.minConfidence;
  const cheapPasses = optimization.modelRouting.maxCheapPasses;
  const confidenceLabel =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? `confidence >= ${Math.round(confidence * 100)}%`
      : "confidence default";
  const passesLabel =
    typeof cheapPasses === "number" && Number.isFinite(cheapPasses)
      ? `${cheapPasses} cheap passes`
      : "default passes";
  return `${confidenceLabel} | ${passesLabel}`;
}

function formatSubagentSummary(
  optimization: import("./agents-utils.ts").AgentOptimizationSummary,
): string {
  const parts = [
    optimization.subagents.autoTier ? "auto-tier on" : "auto-tier off",
    optimization.subagents.simpleTaskModel ? optimization.subagents.simpleTaskModel : null,
    optimization.subagents.parallelResearchEnabled
      ? `research fan-out ${optimization.subagents.parallelResearchMaxConcurrent ?? 3}`
      : "serial research",
    optimization.subagents.structuredResults ? "structured results" : null,
  ].filter(Boolean);
  return parts.join(" | ");
}





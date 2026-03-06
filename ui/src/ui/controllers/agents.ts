import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, GatewayModelChoice, ToolsCatalogResult } from "../types.ts";

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  agentModelChoices: GatewayModelChoice[];
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
};

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadAgentModelChoices(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<{ models?: unknown[] }>("models.list", {
      includeAll: true,
    });
    const models = Array.isArray(res?.models) ? res.models : [];
    const seen = new Set<string>();
    state.agentModelChoices = models.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const provider =
        typeof (entry as { provider?: unknown }).provider === "string"
          ? (entry as { provider: string }).provider.trim()
          : "";
      const id =
        typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id.trim()
          : "";
      if (!provider || !id) {
        return [];
      }
      const key = `${provider}/${id}`.toLowerCase();
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      const name =
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name.trim()
          : id;
      return [
        {
          ...(entry as Omit<GatewayModelChoice, "id" | "name" | "provider">),
          id,
          name: name || id,
          provider,
        } satisfies GatewayModelChoice,
      ];
    });
  } catch {
    state.agentModelChoices = [];
  }
}

export async function loadToolsCatalog(state: AgentsState, agentId?: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.toolsCatalogLoading) {
    return;
  }
  state.toolsCatalogLoading = true;
  state.toolsCatalogError = null;
  try {
    const res = await state.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: agentId ?? state.agentsSelectedId ?? undefined,
      includePlugins: true,
    });
    if (res) {
      state.toolsCatalogResult = res;
    }
  } catch (err) {
    state.toolsCatalogError = String(err);
  } finally {
    state.toolsCatalogLoading = false;
  }
}


import { registerSkillsChangeListener } from "../agents/skills/refresh.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  primeRemoteSkillsCache,
  refreshRemoteBinsForConnectedNodes,
  setSkillsRemoteRegistry,
} from "../infra/skills-remote.js";

const DEFAULT_SKILLS_REFRESH_DELAY_MS = 30_000;

export function startGatewayRemoteSkillsSync(params: {
  enabled: boolean;
  nodeRegistry: Parameters<typeof setSkillsRemoteRegistry>[0];
  loadConfig: () => OpenClawConfig;
  refreshDelayMs?: number;
}): {
  stop: () => void;
} {
  if (!params.enabled) {
    return { stop: () => {} };
  }

  setSkillsRemoteRegistry(params.nodeRegistry);
  void primeRemoteSkillsCache();

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshDelayMs = params.refreshDelayMs ?? DEFAULT_SKILLS_REFRESH_DELAY_MS;
  const unsubscribe = registerSkillsChangeListener((event) => {
    if (event.reason === "remote-node") {
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshRemoteBinsForConnectedNodes(params.loadConfig());
    }, refreshDelayMs);
  });

  return {
    stop: () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      unsubscribe();
      setSkillsRemoteRegistry(null);
    },
  };
}

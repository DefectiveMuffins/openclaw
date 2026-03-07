import type { OpenClawConfig } from "../config/config.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import { startGatewayDiscovery } from "./server-discovery-runtime.js";

export async function startGatewayDiscoveryRegistrar(params: {
  enabled: boolean;
  cfg: OpenClawConfig;
  port: number;
  gatewayTls?: { enabled: boolean; fingerprintSha256?: string };
  tailscaleMode: Parameters<typeof startGatewayDiscovery>[0]["tailscaleMode"];
  logDiscovery: Parameters<typeof startGatewayDiscovery>[0]["logDiscovery"];
}): Promise<(() => Promise<void>) | null> {
  if (!params.enabled) {
    return null;
  }

  const machineDisplayName = await getMachineDisplayName();
  const discovery = await startGatewayDiscovery({
    machineDisplayName,
    port: params.port,
    gatewayTls: params.gatewayTls,
    wideAreaDiscoveryEnabled: params.cfg.discovery?.wideArea?.enabled === true,
    wideAreaDiscoveryDomain: params.cfg.discovery?.wideArea?.domain,
    tailscaleMode: params.tailscaleMode,
    mdnsMode: params.cfg.discovery?.mdns?.mode,
    logDiscovery: params.logDiscovery,
  });
  return discovery.bonjourStop;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const getMachineDisplayName = vi.hoisted(() => vi.fn());
const startGatewayDiscovery = vi.hoisted(() => vi.fn());

vi.mock("../infra/machine-name.js", () => ({
  getMachineDisplayName: (...args: Parameters<typeof getMachineDisplayName>) =>
    getMachineDisplayName(...args),
}));

vi.mock("./server-discovery-runtime.js", () => ({
  startGatewayDiscovery: (...args: Parameters<typeof startGatewayDiscovery>) =>
    startGatewayDiscovery(...args),
}));

import { startGatewayDiscoveryRegistrar } from "./server-discovery-registrar.js";

describe("startGatewayDiscoveryRegistrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without starting discovery when disabled", async () => {
    const bonjourStop = await startGatewayDiscoveryRegistrar({
      enabled: false,
      cfg: {} as never,
      port: 18_789,
      tailscaleMode: "off",
      logDiscovery: { info: vi.fn(), warn: vi.fn() },
    });

    expect(bonjourStop).toBeNull();
    expect(getMachineDisplayName).not.toHaveBeenCalled();
    expect(startGatewayDiscovery).not.toHaveBeenCalled();
  });

  it("starts discovery with config-derived settings when enabled", async () => {
    const bonjourStop = vi.fn(async () => {});
    const logDiscovery = { info: vi.fn(), warn: vi.fn() };
    const cfg = {
      discovery: {
        wideArea: { enabled: true, domain: "tailnet.example.ts.net" },
        mdns: { mode: "full" },
      },
    } as never;
    getMachineDisplayName.mockResolvedValueOnce("Gateway Host");
    startGatewayDiscovery.mockResolvedValueOnce({ bonjourStop });

    const result = await startGatewayDiscoveryRegistrar({
      enabled: true,
      cfg,
      port: 18_789,
      gatewayTls: { enabled: true, fingerprintSha256: "abc123" },
      tailscaleMode: "serve",
      logDiscovery,
    });

    expect(result).toBe(bonjourStop);
    expect(getMachineDisplayName).toHaveBeenCalledTimes(1);
    expect(startGatewayDiscovery).toHaveBeenCalledWith({
      machineDisplayName: "Gateway Host",
      port: 18_789,
      gatewayTls: { enabled: true, fingerprintSha256: "abc123" },
      wideAreaDiscoveryEnabled: true,
      wideAreaDiscoveryDomain: "tailnet.example.ts.net",
      tailscaleMode: "serve",
      mdnsMode: "full",
      logDiscovery,
    });
  });
});

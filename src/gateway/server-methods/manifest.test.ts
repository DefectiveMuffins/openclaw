import { describe, expect, it, vi } from "vitest";
import {
  buildGatewayHandlerManifest,
  findGatewayHandlerManifestEntry,
  handlersFromGatewayHandlerManifest,
} from "./manifest.js";

describe("gateway handler manifest", () => {
  it("records per-method auth and control-plane write metadata", () => {
    const health = vi.fn();
    const status = vi.fn();
    const configApply = vi.fn();

    const manifest = buildGatewayHandlerManifest([
      {
        handlers: {
          health,
          status,
        },
        methodAuth: { health: "none" },
      },
      {
        handlers: {
          "config.apply": configApply,
        },
        controlPlaneWriteMethods: ["config.apply"],
      },
    ]);

    expect(findGatewayHandlerManifestEntry(manifest, "health")).toMatchObject({
      method: "health",
      auth: "none",
      handler: health,
    });
    expect(findGatewayHandlerManifestEntry(manifest, "status")).toMatchObject({
      method: "status",
      handler: status,
    });
    expect(findGatewayHandlerManifestEntry(manifest, "config.apply")).toMatchObject({
      method: "config.apply",
      controlPlaneWrite: true,
      handler: configApply,
    });
  });

  it("keeps the latest handler for duplicate methods", () => {
    const first = vi.fn();
    const second = vi.fn();

    const manifest = buildGatewayHandlerManifest([
      { handlers: { status: first } },
      { handlers: { status: second }, auth: "none" },
    ]);

    expect(handlersFromGatewayHandlerManifest(manifest).status).toBe(second);
    expect(findGatewayHandlerManifestEntry(manifest, "status")).toMatchObject({
      method: "status",
      auth: "none",
      handler: second,
    });
  });
});

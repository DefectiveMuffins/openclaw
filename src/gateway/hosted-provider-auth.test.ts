import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { __testing } from "./hosted-provider-auth.js";

describe("createHostedProviderPluginLoadConfig", () => {
  it("restricts plugin loading to the requested auth plugin while preserving its config", () => {
    const config: OpenClawConfig = {
      plugins: {
        enabled: true,
        allow: ["other-plugin"],
        load: {
          paths: ["C:/plugins/custom"],
        },
        entries: {
          "other-plugin": {
            enabled: true,
            config: { keep: true },
          },
          "google-gemini-cli-auth": {
            config: { existing: true },
          },
        },
      },
    };

    const next = __testing.createHostedProviderPluginLoadConfig(
      config,
      "google-gemini-cli-auth",
    );

    expect(next.plugins?.enabled).toBe(true);
    expect(next.plugins?.allow).toEqual(["google-gemini-cli-auth"]);
    expect(next.plugins?.load?.paths).toEqual(["C:/plugins/custom"]);
    expect(next.plugins?.entries?.["google-gemini-cli-auth"]).toEqual({
      enabled: true,
      config: { existing: true },
    });
    expect(next.plugins?.entries?.["other-plugin"]).toEqual({
      enabled: true,
      config: { keep: true },
    });
  });
});

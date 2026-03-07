import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureControlUiAssetsBuilt = vi.hoisted(() =>
  vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true })),
);
const resolveControlUiRootOverrideSync = vi.hoisted(() =>
  vi.fn<(value: string) => string | null>(),
);
const resolveControlUiRootSync = vi.hoisted(() => vi.fn<() => string | null>());

vi.mock("../infra/control-ui-assets.js", () => ({
  ensureControlUiAssetsBuilt: (...args: Parameters<typeof ensureControlUiAssetsBuilt>) =>
    ensureControlUiAssetsBuilt(...args),
  resolveControlUiRootOverrideSync: (
    ...args: Parameters<typeof resolveControlUiRootOverrideSync>
  ) => resolveControlUiRootOverrideSync(...args),
  resolveControlUiRootSync: (...args: Parameters<typeof resolveControlUiRootSync>) =>
    resolveControlUiRootSync(...args),
}));

import { resolveGatewayControlUiRootState } from "./server-control-ui-root.js";

describe("resolveGatewayControlUiRootState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns invalid override state and warns when override path is missing", async () => {
    resolveControlUiRootOverrideSync.mockReturnValueOnce(null);
    const warn = vi.fn();
    const overridePath = path.join("tmp", "missing-ui");

    const state = await resolveGatewayControlUiRootState({
      controlUiRootOverride: overridePath,
      controlUiEnabled: true,
      runtime: {} as never,
      log: { warn },
      moduleUrl: import.meta.url,
      argv1: "gateway",
      cwd: process.cwd(),
    });

    expect(state).toEqual({ kind: "invalid", path: path.resolve(overridePath) });
    expect(warn).toHaveBeenCalledWith(
      "gateway: controlUi.root not found at " + path.resolve(overridePath),
    );
    expect(ensureControlUiAssetsBuilt).not.toHaveBeenCalled();
  });

  it("tries to build assets before reporting a missing control UI root", async () => {
    resolveControlUiRootSync.mockReturnValueOnce(null).mockReturnValueOnce("resolved/ui");
    ensureControlUiAssetsBuilt.mockResolvedValueOnce({ ok: false, message: "assets missing" });
    const warn = vi.fn();

    const state = await resolveGatewayControlUiRootState({
      controlUiEnabled: true,
      runtime: {} as never,
      log: { warn },
      moduleUrl: import.meta.url,
      argv1: "gateway",
      cwd: process.cwd(),
    });

    expect(state).toEqual({ kind: "resolved", path: "resolved/ui" });
    expect(ensureControlUiAssetsBuilt).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("gateway: assets missing");
  });

  it("returns undefined when the control UI is disabled and no override is set", async () => {
    const warn = vi.fn();

    const state = await resolveGatewayControlUiRootState({
      controlUiEnabled: false,
      runtime: {} as never,
      log: { warn },
      moduleUrl: import.meta.url,
      argv1: "gateway",
      cwd: process.cwd(),
    });

    expect(state).toBeUndefined();
    expect(resolveControlUiRootSync).not.toHaveBeenCalled();
    expect(ensureControlUiAssetsBuilt).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

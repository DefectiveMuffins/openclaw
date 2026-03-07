import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WindowWithBasePath = Window &
  typeof globalThis & {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
  };

let originalPath = "/";

function expectedGatewayUrl(basePath: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${basePath}`;
}

describe("loadSettings default gateway URL derivation", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    delete (window as WindowWithBasePath).__OPENCLAW_CONTROL_UI_BASE_PATH__;
  });

  afterEach(() => {
    delete (window as WindowWithBasePath).__OPENCLAW_CONTROL_UI_BASE_PATH__;
    window.history.replaceState({}, "", originalPath);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses configured base path and normalizes trailing slash", async () => {
    window.history.replaceState({}, "", "/ignored/path");
    (window as WindowWithBasePath).__OPENCLAW_CONTROL_UI_BASE_PATH__ = " /openclaw/ ";

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/openclaw"));
  });

  it("infers base path from nested pathname when configured base path is not set", async () => {
    window.history.replaceState({}, "", "/apps/openclaw/chat");

    const { loadSettings } = await import("./storage.ts");
    expect(loadSettings().gatewayUrl).toBe(expectedGatewayUrl("/apps/openclaw"));
  });
});

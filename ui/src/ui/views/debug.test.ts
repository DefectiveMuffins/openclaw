import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderDebug } from "./debug.ts";

describe("debug view", () => {
  it("runs a safe preset through the manual RPC form", () => {
    const container = document.createElement("div");
    const onCallMethodChange = vi.fn();
    const onCallParamsChange = vi.fn();
    const onCall = vi.fn();

    render(
      renderDebug({
        loading: false,
        status: null,
        health: null,
        models: [],
        heartbeat: null,
        eventLog: [],
        callMethod: "",
        callParams: "{}",
        callResult: null,
        callError: null,
        onCallMethodChange,
        onCallParamsChange,
        onRefresh: () => undefined,
        onCall,
      }),
      container,
    );

    const healthPreset = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Health",
    );
    expect(healthPreset).not.toBeUndefined();
    healthPreset?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onCallMethodChange).toHaveBeenCalledWith("health");
    expect(onCallParamsChange).toHaveBeenCalledWith("{}");
    expect(onCall).toHaveBeenCalled();
  });
});

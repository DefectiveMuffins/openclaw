import { describe, expect, it } from "vitest";
import { parseLogLine, stripAnsiCodes } from "./logs.ts";

describe("logs controller", () => {
  it("strips ANSI control sequences from plain log lines", () => {
    expect(stripAnsiCodes("\u001b[31merror\u001b[0m happened")).toBe("error happened");
  });

  it("sanitizes subsystem and message fields when parsing JSON logs", () => {
    const entry = parseLogLine(
      JSON.stringify({
        0: '{"subsystem":"\u001b[36mworker\u001b[0m"}',
        1: "\u001b[31mfailed\u001b[0m request",
        _meta: { logLevelName: "error", date: "2026-03-07T12:00:00.000Z" },
      }),
    );

    expect(entry.subsystem).toBe("worker");
    expect(entry.message).toBe("failed request");
    expect(entry.raw).toContain("\\u001b");
  });
});

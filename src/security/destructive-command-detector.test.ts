import { describe, expect, it } from "vitest";
import { isDestructiveCommand } from "./destructive-command-detector.js";

describe("isDestructiveCommand", () => {
  it("detects common destructive commands", () => {
    expect(isDestructiveCommand("rm -rf /tmp/foo")).toEqual({
      destructive: true,
      pattern: "rm-recursive",
    });
    expect(isDestructiveCommand("git reset --hard HEAD~1")).toEqual({
      destructive: true,
      pattern: "git-reset-hard",
    });
    expect(isDestructiveCommand("chmod -R 777 /etc")).toEqual({
      destructive: true,
      pattern: "chmod-recursive-system",
    });
    expect(isDestructiveCommand("echo hi > /tmp/test.txt")).toEqual({
      destructive: true,
      pattern: "truncate-redirect-absolute",
    });
  });

  it("does not flag benign commands", () => {
    expect(isDestructiveCommand("ls -la")).toEqual({ destructive: false });
    expect(isDestructiveCommand("git status")).toEqual({ destructive: false });
    expect(isDestructiveCommand("echo hello")).toEqual({ destructive: false });
  });
});

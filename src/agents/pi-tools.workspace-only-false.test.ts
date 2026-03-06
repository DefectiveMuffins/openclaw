import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOpenClawCodingTools } from "./pi-tools.js";

describe("FS tools with workspaceOnly=false", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let outsideFile: string;

  const hasToolError = (result: { content: Array<{ type: string; text?: string }> }) =>
    result.content.some((content) => {
      if (content.type !== "text") {
        return false;
      }
      return content.text?.toLowerCase().includes("error") ?? false;
    });

  const toolsFor = (workspaceOnly: boolean | undefined) =>
    createOpenClawCodingTools({
      workspaceDir,
      config:
        workspaceOnly === undefined
          ? {}
          : {
              tools: {
                fs: {
                  workspaceOnly,
                },
              },
            },
    });

  const toolsForFsConfig = (fsConfig: {
    workspaceOnly?: boolean;
    allowPaths?: string[];
    denyPaths?: string[];
    readOnlyPaths?: string[];
  }) =>
    createOpenClawCodingTools({
      workspaceDir,
      config: {
        tools: {
          fs: fsConfig,
        },
      },
    });

  const runFsTool = async (
    toolName: "write" | "edit" | "read",
    callId: string,
    input: Record<string, unknown>,
    workspaceOnly: boolean | undefined,
  ) => {
    const tool = toolsFor(workspaceOnly).find((candidate) => candidate.name === toolName);
    expect(tool).toBeDefined();
    const result = await tool!.execute(callId, input);
    expect(hasToolError(result)).toBe(false);
    return result;
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir);
    outsideFile = path.join(tmpDir, "outside.txt");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should allow write outside workspace when workspaceOnly=false", async () => {
    await runFsTool(
      "write",
      "test-call-1",
      {
        path: outsideFile,
        content: "test content",
      },
      false,
    );
    const content = await fs.readFile(outsideFile, "utf-8");
    expect(content).toBe("test content");
  });

  it("should allow write outside workspace via ../ path when workspaceOnly=false", async () => {
    const relativeOutsidePath = path.join("..", "outside-relative-write.txt");
    const outsideRelativeFile = path.join(tmpDir, "outside-relative-write.txt");

    await runFsTool(
      "write",
      "test-call-1b",
      {
        path: relativeOutsidePath,
        content: "relative test content",
      },
      false,
    );
    const content = await fs.readFile(outsideRelativeFile, "utf-8");
    expect(content).toBe("relative test content");
  });

  it("should allow edit outside workspace when workspaceOnly=false", async () => {
    await fs.writeFile(outsideFile, "old content");

    await runFsTool(
      "edit",
      "test-call-2",
      {
        path: outsideFile,
        oldText: "old content",
        newText: "new content",
      },
      false,
    );
    const content = await fs.readFile(outsideFile, "utf-8");
    expect(content).toBe("new content");
  });

  it("should allow edit outside workspace via ../ path when workspaceOnly=false", async () => {
    const relativeOutsidePath = path.join("..", "outside-relative-edit.txt");
    const outsideRelativeFile = path.join(tmpDir, "outside-relative-edit.txt");
    await fs.writeFile(outsideRelativeFile, "old relative content");

    await runFsTool(
      "edit",
      "test-call-2b",
      {
        path: relativeOutsidePath,
        oldText: "old relative content",
        newText: "new relative content",
      },
      false,
    );
    const content = await fs.readFile(outsideRelativeFile, "utf-8");
    expect(content).toBe("new relative content");
  });

  it("should allow read outside workspace when workspaceOnly=false", async () => {
    await fs.writeFile(outsideFile, "test read content");

    await runFsTool(
      "read",
      "test-call-3",
      {
        path: outsideFile,
      },
      false,
    );
  });

  it("should allow write outside workspace when workspaceOnly is unset", async () => {
    const outsideUnsetFile = path.join(tmpDir, "outside-unset-write.txt");
    await runFsTool(
      "write",
      "test-call-3a",
      {
        path: outsideUnsetFile,
        content: "unset write content",
      },
      undefined,
    );
    const content = await fs.readFile(outsideUnsetFile, "utf-8");
    expect(content).toBe("unset write content");
  });

  it("should allow edit outside workspace when workspaceOnly is unset", async () => {
    const outsideUnsetFile = path.join(tmpDir, "outside-unset-edit.txt");
    await fs.writeFile(outsideUnsetFile, "before");
    await runFsTool(
      "edit",
      "test-call-3b",
      {
        path: outsideUnsetFile,
        oldText: "before",
        newText: "after",
      },
      undefined,
    );
    const content = await fs.readFile(outsideUnsetFile, "utf-8");
    expect(content).toBe("after");
  });

  it("should block write outside workspace when workspaceOnly=true", async () => {
    const tools = toolsFor(true);
    const writeTool = tools.find((t) => t.name === "write");
    expect(writeTool).toBeDefined();

    // When workspaceOnly=true, the guard throws an error
    await expect(
      writeTool!.execute("test-call-4", {
        path: outsideFile,
        content: "test content",
      }),
    ).rejects.toThrow(/Path escapes (workspace|sandbox) root/);
  });

  it("enforces denyPaths when workspaceOnly=false", async () => {
    const deniedPath = path.join(workspaceDir, "secrets", "key.txt");
    const tools = toolsForFsConfig({
      workspaceOnly: false,
      denyPaths: ["secrets/"],
    });
    const writeTool = tools.find((tool) => tool.name === "write");
    expect(writeTool).toBeDefined();

    await expect(
      writeTool!.execute("test-call-deny-paths", {
        path: deniedPath,
        content: "secret",
      }),
    ).rejects.toThrow(/Filesystem access denied: path denied by tools\.fs\.denyPaths: secrets\//);
  });

  it("enforces allowPaths when workspaceOnly=false", async () => {
    const blockedPath = path.join(workspaceDir, "notes", "todo.md");
    const tools = toolsForFsConfig({
      workspaceOnly: false,
      allowPaths: ["memory/"],
    });
    const writeTool = tools.find((tool) => tool.name === "write");
    expect(writeTool).toBeDefined();

    await expect(
      writeTool!.execute("test-call-allow-paths", {
        path: blockedPath,
        content: "todo",
      }),
    ).rejects.toThrow(/Filesystem access denied: path is outside tools\.fs\.allowPaths/);
  });

  it("enforces readOnlyPaths when workspaceOnly=false", async () => {
    const readonlyPath = path.join(workspaceDir, "AGENTS.md");
    await fs.writeFile(readonlyPath, "before");
    const tools = toolsForFsConfig({
      workspaceOnly: false,
      readOnlyPaths: ["AGENTS.md"],
    });
    const editTool = tools.find((tool) => tool.name === "edit");
    expect(editTool).toBeDefined();

    await expect(
      editTool!.execute("test-call-readonly", {
        path: readonlyPath,
        oldText: "before",
        newText: "after",
      }),
    ).rejects.toThrow(
      /Filesystem access denied: path is read-only via tools\.fs\.readOnlyPaths: AGENTS\.md/,
    );
  });
});

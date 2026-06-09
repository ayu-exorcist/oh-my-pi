import { describe, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const { executeByName, factoryByName } = vi.hoisted(() => {
  const executeByName = new Map<string, ReturnType<typeof vi.fn>>();
  const factoryByName = new Map<string, ReturnType<typeof vi.fn>>();
  const makeFactory = (name: string) => {
    const execute = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: `${name} result` }] });
    executeByName.set(name, execute);
    const factory = vi.fn((cwd: string) => ({
      description: `${name} description for ${cwd}`,
      parameters: { type: "object", name },
      execute,
    }));
    factoryByName.set(name, factory);
    return factory;
  };

  return {
    executeByName,
    factoryByName,
    createReadTool: makeFactory("read"),
    createBashTool: makeFactory("bash"),
    createEditTool: makeFactory("edit"),
    createWriteTool: makeFactory("write"),
    createFindTool: makeFactory("find"),
    createGrepTool: makeFactory("grep"),
    createLsTool: makeFactory("ls"),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createReadTool: factoryByName.get("read"),
  createBashTool: factoryByName.get("bash"),
  createEditTool: factoryByName.get("edit"),
  createWriteTool: factoryByName.get("write"),
  createFindTool: factoryByName.get("find"),
  createGrepTool: factoryByName.get("grep"),
  createLsTool: factoryByName.get("ls"),
}));

import briefExtension from "./index";

interface RegisteredTool {
  readonly name: string;
  readonly execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((value: unknown) => void) | undefined,
    ctx: ExtensionContext,
  ) => Promise<unknown>;
}

function createMockApi() {
  const tools = new Map<string, RegisteredTool>();
  const api = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
    registerCommand: vi.fn(),
    on: vi.fn(),
    appendEntry: vi.fn(),
  } as unknown as ExtensionAPI;

  return { api, tools };
}

function getTool(tools: ReadonlyMap<string, RegisteredTool>, name: string): RegisteredTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("pi-brief execute wrappers", () => {
  test("delegates every brief tool execute call to the cwd-scoped built-in tool", async () => {
    const { api, tools } = createMockApi();
    briefExtension(api);
    const signal = new AbortController().signal;
    const onUpdate = vi.fn();
    const ctx = { cwd: "/workspace" } as unknown as ExtensionContext;

    for (const name of ["read", "bash", "edit", "write", "find", "grep", "ls"]) {
      const params = { value: name };
      await expect(
        getTool(tools, name).execute("tool-call", params, signal, onUpdate, ctx),
      ).resolves.toEqual({
        content: [{ type: "text", text: `${name} result` }],
      });
      expect(factoryByName.get(name)).toHaveBeenCalledWith("/workspace");
      expect(executeByName.get(name)).toHaveBeenCalledWith("tool-call", params, signal, onUpdate);
    }
  });
});

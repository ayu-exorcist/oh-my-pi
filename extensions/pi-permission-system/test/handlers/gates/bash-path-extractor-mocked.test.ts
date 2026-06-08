import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockNode = {
  type: string;
  text: string;
  childCount: number;
  child(index: number): MockNode | null;
};

type MockTree = {
  rootNode: MockNode;
  delete(): void;
};

let currentTree: MockTree | null = null;

vi.mock("web-tree-sitter", () => {
  class Parser {
    static init = vi.fn().mockResolvedValue(undefined);

    setLanguage(): void {}

    parse(): MockTree | null {
      return currentTree;
    }

    delete(): void {}
  }

  const Language = {
    load: vi.fn().mockResolvedValue({}),
  };

  return { Parser, Language };
});

function makeNode(type: string, text = "", children: Array<MockNode | null> = []): MockNode {
  return {
    type,
    text,
    childCount: children.length,
    child(index: number): MockNode | null {
      return children[index] ?? null;
    },
  };
}

function makeTree(rootNode: MockNode): MockTree {
  return {
    rootNode,
    delete(): void {},
  };
}

async function loadExtractor() {
  vi.resetModules();
  return await import("#src/handlers/gates/bash-path-extractor");
}

function cwd(): string {
  return process.platform === "win32" ? "C:\\workspace\\project" : "/workspace/project";
}

beforeEach(() => {
  currentTree = null;
});

afterEach(() => {
  currentTree = null;
  vi.restoreAllMocks();
});

describe("mocked bash path extractor branches", () => {
  it("returns empty arrays when the parser yields no tree", async () => {
    const { extractExternalPathsFromBashCommand, extractTokensForPathRules } =
      await loadExtractor();

    currentTree = null;
    await expect(extractExternalPathsFromBashCommand("anything", cwd())).resolves.toEqual([]);
    await expect(extractTokensForPathRules("anything")).resolves.toEqual([]);
  });

  it("walks mixed AST nodes and filters path candidates", async () => {
    const rootNode = makeNode("program", "", [
      null,
      makeNode("command", "", [
        null,
        makeNode("word", "echo"),
        makeNode("raw_string", "foo"),
        makeNode("raw_string", "''"),
        makeNode("string", "", [null, makeNode("string_content", "abc")]),
        makeNode("concatenation", "", [null, makeNode("word", "./combo.ts")]),
        makeNode("file_redirect", "", [null, makeNode("raw_string", "'./redirect.txt'")]),
        makeNode("word", "FOO=/bar"),
        makeNode("word", "./foo.*"),
        makeNode("word", "../outside.txt"),
        makeNode("word", "~/home.txt"),
        makeNode("word", "C:\\Temp\\log.txt"),
        makeNode("word", "foo..bar"),
      ]),
      null,
    ]);
    currentTree = makeTree(rootNode);

    const { extractExternalPathsFromBashCommand, extractTokensForPathRules } =
      await loadExtractor();
    const ruleTokens = await extractTokensForPathRules("ignored");

    expect(ruleTokens).toEqual([
      "./combo.ts",
      "./redirect.txt",
      "../outside.txt",
      "~/home.txt",
      "C:\\Temp\\log.txt",
      "foo..bar",
    ]);

    const externalPaths = await extractExternalPathsFromBashCommand("ignored", cwd());
    expect(externalPaths.some((path) => path.includes("outside.txt"))).toBe(true);
    expect(externalPaths.some((path) => path.includes("home.txt"))).toBe(true);
  });

  it("handles leading cd targets and bare cd commands", async () => {
    const { extractExternalPathsFromBashCommand } = await loadExtractor();

    currentTree = makeTree(makeNode("program", "", []));
    await expect(extractExternalPathsFromBashCommand("ignored", cwd())).resolves.toEqual([]);

    currentTree = makeTree(
      makeNode("program", "", [
        makeNode("command", "", [
          makeNode("command_name", "cd"),
          null,
          makeNode("file_redirect", "", [makeNode("word", "ignored")]),
          makeNode("word", "--"),
          makeNode("word", "subdir"),
        ]),
      ]),
    );
    await expect(extractExternalPathsFromBashCommand("ignored", cwd())).resolves.toEqual([]);

    currentTree = makeTree(
      makeNode("program", "", [makeNode("command", "", [makeNode("command_name", "cd")])]),
    );
    await expect(extractExternalPathsFromBashCommand("ignored", cwd())).resolves.toEqual([]);
  });
});

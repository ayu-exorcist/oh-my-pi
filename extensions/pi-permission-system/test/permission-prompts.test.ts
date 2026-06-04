import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock tool-input-preview collaborator before importing the module under test.
vi.mock("../src/tool-input-preview.js", () => ({
  formatToolInputForPrompt: vi.fn(() => "mocked preview"),
}));

import {
  formatAskPrompt,
  formatMissingToolNameReason,
  formatSkillAskPrompt,
  formatSkillPathAskPrompt,
  formatUnknownToolReason,
} from "#src/permission-prompts";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import { formatToolInputForPrompt } from "#src/tool-input-preview";
import type { PermissionCheckResult } from "#src/types";

const mockedFormatToolInput = vi.mocked(formatToolInputForPrompt);

beforeEach(() => {
  mockedFormatToolInput.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function toolResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function mcpResult(
  target: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "mcp",
    target,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function skillEntry(name: string): SkillPromptEntry {
  return {
    name,
    description: "A skill",
    location: `/skills/${name}/SKILL.md`,
    state: "ask",
    normalizedLocation: `/skills/${name}/SKILL.md`,
    normalizedBaseDir: `/skills/${name}`,
  };
}

describe("formatMissingToolNameReason", () => {
  test("mentions missing tool name and pi.getAllTools()", () => {
    const result = formatMissingToolNameReason();
    expect(result).toContain("no tool name");
    expect(result).toContain("pi.getAllTools()");
  });
});

describe("formatUnknownToolReason", () => {
  test("mentions the unknown tool name and lists available tools", () => {
    const result = formatUnknownToolReason("phantom", ["read", "write"]);
    expect(result).toContain("phantom");
    expect(result).toContain("read");
    expect(result).toContain("write");
  });

  test("includes MCP hint for non-mcp tool names", () => {
    const result = formatUnknownToolReason("my-server:tool", ["mcp"]);
    expect(result).toContain("mcp");
  });

  test("omits MCP hint when tool name is 'mcp'", () => {
    const result = formatUnknownToolReason("mcp", []);
    expect(result).not.toContain("call the registered 'mcp' tool");
  });

  test("shows 'none' when no tools are registered", () => {
    const result = formatUnknownToolReason("ghost", []);
    expect(result).toContain("none");
  });

  test("caps preview at 10 tools and appends ellipsis for longer lists", () => {
    const tools = Array.from({ length: 15 }, (_, i) => `tool${i}`);
    const result = formatUnknownToolReason("ghost", tools);
    expect(result).toContain("...");
  });
});

describe("formatAskPrompt", () => {
  test("uses 'Current agent' when no agent name given", () => {
    const result = formatAskPrompt(toolResult("read"), undefined, {
      path: "/src",
    });
    expect(result).toContain("Current agent");
  });

  test("uses agent name when provided", () => {
    const result = formatAskPrompt(toolResult("read"), "my-agent", {
      path: "/src",
    });
    expect(result).toContain("Agent 'my-agent'");
  });

  test("formats bash prompt with command and no tool-input-preview call", () => {
    const result = formatAskPrompt(toolResult("bash", { command: "git status" }));
    expect(result).toContain("git status");
    expect(result).toContain("Allow this command?");
    expect(mockedFormatToolInput).not.toHaveBeenCalled();
  });

  test("formats bash prompt with matched pattern", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push", matchedPattern: "git *" }),
    );
    expect(result).toContain("matched 'git *'");
  });

  test("formats MCP prompt with target", () => {
    const result = formatAskPrompt(mcpResult("server:query"));
    expect(result).toContain("server:query");
    expect(result).toContain("Allow this call?");
    expect(mockedFormatToolInput).not.toHaveBeenCalled();
  });

  test("formats MCP prompt with matched pattern", () => {
    const result = formatAskPrompt(mcpResult("server:query", { matchedPattern: "server:*" }));
    expect(result).toContain("matched 'server:*'");
  });

  test("calls formatToolInputForPrompt for non-bash non-mcp tools", () => {
    mockedFormatToolInput.mockReturnValue("for '/src/foo.ts'");
    const result = formatAskPrompt(toolResult("read"), undefined, {
      path: "/src/foo.ts",
    });
    expect(mockedFormatToolInput).toHaveBeenCalledWith("read", {
      path: "/src/foo.ts",
    });
    expect(result).toContain("for '/src/foo.ts'");
    expect(result).toContain("Allow this call?");
  });

  test("omits input suffix when formatToolInputForPrompt returns empty string", () => {
    mockedFormatToolInput.mockReturnValue("");
    const result = formatAskPrompt(toolResult("task"));
    expect(result).toContain("task");
    expect(result).not.toContain("undefined");
  });
});

describe("formatSkillAskPrompt", () => {
  test("includes skill name and agent name", () => {
    const result = formatSkillAskPrompt("librarian", "my-agent");
    expect(result).toContain("librarian");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatSkillAskPrompt("librarian");
    expect(result).toContain("Current agent");
    expect(result).toContain("librarian");
  });
});

describe("formatSkillPathAskPrompt", () => {
  test("includes skill name, read path, and agent name", () => {
    const result = formatSkillPathAskPrompt(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
      "my-agent",
    );
    expect(result).toContain("librarian");
    expect(result).toContain("/skills/librarian/SKILL.md");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatSkillPathAskPrompt(skillEntry("librarian"), "/skills/librarian/SKILL.md");
    expect(result).toContain("Current agent");
  });
});

// formatSkillPathDenyReason has moved to denial-messages.ts.
// Its behavior is tested in denial-messages.test.ts.

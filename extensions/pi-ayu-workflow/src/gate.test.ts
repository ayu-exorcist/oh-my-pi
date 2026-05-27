import { describe, expect, test } from "vitest";
import {
  dangerousShellSyntaxPattern,
  getArrayField,
  getLockedToolBlockReason,
  getNestedToolBlockReason,
  getStringField,
  hasDisallowedGitInspectionOption,
  isBashToolName,
  isReadOnlyGitInspectionCommand,
  isRecord,
  isToolNamePotentiallyMutating,
} from "./gate";

describe("Ayu Write Gate", () => {
  test("allows narrow read-only git inspection commands", () => {
    expect(isReadOnlyGitInspectionCommand("git status")).toBe(true);
    expect(isReadOnlyGitInspectionCommand("git --no-pager diff -- src/index.ts")).toBe(true);
    expect(isReadOnlyGitInspectionCommand("git log --oneline -5")).toBe(true);
    expect(isReadOnlyGitInspectionCommand("git show HEAD -- README.md")).toBe(true);
    expect(isReadOnlyGitInspectionCommand("git branch --show-current")).toBe(true);
  });

  test("rejects shell syntax and non-inspection git commands", () => {
    expect(isReadOnlyGitInspectionCommand("")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git status && rm -rf dist")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git status\ngit diff")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git commit -m test")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git branch feature/test")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git show --format=raw HEAD")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git show --format=medium HEAD")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git --no-pager")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("git restore --source HEAD -- README.md")).toBe(false);
    expect(isReadOnlyGitInspectionCommand("npm test")).toBe(false);
  });

  test("rejects disallowed git inspection options", () => {
    expect(hasDisallowedGitInspectionOption(["--ext-diff"])).toBe(true);
    expect(hasDisallowedGitInspectionOption(["--textconv"])).toBe(true);
    expect(hasDisallowedGitInspectionOption(["--output", "diff.txt"])).toBe(true);
    expect(hasDisallowedGitInspectionOption(["--output=diff.txt"])).toBe(true);
    expect(hasDisallowedGitInspectionOption(["--stat"])).toBe(false);
  });

  test("detects bash and potentially mutating tool names", () => {
    expect(isBashToolName("bash")).toBe(true);
    expect(isBashToolName("functions.bash")).toBe(true);
    expect(isBashToolName("read")).toBe(false);

    expect(isToolNamePotentiallyMutating("write")).toBe(true);
    expect(isToolNamePotentiallyMutating("workspace.apply_patch")).toBe(true);
    expect(isToolNamePotentiallyMutating("mcp-shell-runner")).toBe(true);
    expect(isToolNamePotentiallyMutating("read")).toBe(false);
  });

  test("blocks direct mutating tools while locked", () => {
    expect(getLockedToolBlockReason("write", {})).toBe(
      "Ayu write gate blocked write while locked.",
    );
    expect(getLockedToolBlockReason("edit", {})).toBe("Ayu write gate blocked edit while locked.");
    expect(getLockedToolBlockReason("workspace.rename", {})).toBe(
      "Ayu write gate blocked potentially mutating tool workspace.rename while locked.",
    );
  });

  test("allows read-only tools and read-only git bash while locked", () => {
    expect(getLockedToolBlockReason("read", { path: "README.md" })).toBeUndefined();
    expect(getLockedToolBlockReason("bash", { command: "git status --short" })).toBeUndefined();
  });

  test("blocks bash without a safe git inspection command while locked", () => {
    expect(getLockedToolBlockReason("bash", { command: "pnpm test" })).toBe(
      "Ayu write gate blocked bash while locked.",
    );
    expect(getLockedToolBlockReason("functions.bash", { command: "git status; rm -rf dist" })).toBe(
      "Ayu write gate blocked functions.bash while locked.",
    );
    expect(getLockedToolBlockReason("bash", {})).toBe("Ayu write gate blocked bash while locked.");
  });

  test("blocks nested mutating tools in multi_tool_use.parallel", () => {
    const safeNested = {
      recipient_name: "functions.bash",
      parameters: { command: "git diff -- README.md" },
    };
    expect(getNestedToolBlockReason(safeNested)).toBeUndefined();
    expect(getNestedToolBlockReason({ recipient_name: "read" })).toBeUndefined();
    expect(getNestedToolBlockReason({})).toBeUndefined();
    expect(getNestedToolBlockReason({ recipient_name: "functions.bash" })).toBe(
      "Ayu write gate blocked nested tool functions.bash while locked.",
    );

    const mutatingNested = {
      recipient_name: "functions.edit",
      parameters: { path: "README.md" },
    };
    expect(getNestedToolBlockReason(mutatingNested)).toBe(
      "Ayu write gate blocked nested tool functions.edit while locked.",
    );

    expect(
      getLockedToolBlockReason("multi_tool_use.parallel", {
        tool_uses: [safeNested, mutatingNested],
      }),
    ).toBe("Ayu write gate blocked nested tool functions.edit while locked.");

    expect(
      getLockedToolBlockReason("multi_tool_use.parallel", {
        tool_uses: [safeNested],
      }),
    ).toBeUndefined();
    expect(getLockedToolBlockReason("multi_tool_use.parallel", {})).toBeUndefined();
  });

  test("blocks unsafe mcp calls while locked", () => {
    expect(getLockedToolBlockReason("mcp", { server: "codegraph" })).toBeUndefined();
    expect(getLockedToolBlockReason("mcp", { search: "symbols" })).toBeUndefined();
    expect(getLockedToolBlockReason("mcp", { action: "ui-messages", args: "{}" })).toBeUndefined();
    expect(getLockedToolBlockReason("mcp", { tool: "search_symbols", args: "{}" })).toBe(
      "Ayu write gate blocked a potentially mutating MCP call while locked.",
    );
    expect(getLockedToolBlockReason("mcp", { tool: "delete_file", args: "{}" })).toBe(
      "Ayu write gate blocked a potentially mutating MCP call while locked.",
    );
    expect(getLockedToolBlockReason("mcp", { randomAction: true })).toBe(
      "Ayu write gate blocked a potentially mutating MCP call while locked.",
    );
  });

  test("provides basic record and shell syntax guards", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(getStringField({ name: "ayu" }, "name")).toBe("ayu");
    expect(getStringField({ name: 1 }, "name")).toBeUndefined();
    expect(getStringField(null, "name")).toBeUndefined();
    expect(getArrayField({ items: ["a"] }, "items")).toEqual(["a"]);
    expect(getArrayField({ items: "a" }, "items")).toBeUndefined();
    expect(getArrayField(null, "items")).toBeUndefined();
    expect(dangerousShellSyntaxPattern.test("git status && git diff")).toBe(true);
    expect(dangerousShellSyntaxPattern.test("git status")).toBe(false);
  });
});

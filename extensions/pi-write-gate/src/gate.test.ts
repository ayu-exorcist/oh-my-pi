import { describe, expect, test } from "vitest";
import {
  classifyBashRiskTier,
  dangerousShellSyntaxPattern,
  getArrayField,
  getLockedToolBlockReason,
  getNestedToolBlockReason,
  getStringField,
  getWriteModeOnBlockReason,
  hasDisallowedGitInspectionOption,
  isBashToolName,
  isReadOnlyGitInspectionCommand,
  isRecord,
  isToolNamePotentiallyMutating,
  type RiskRule,
} from "./gate";

describe("Write Gate", () => {
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
    expect(isReadOnlyGitInspectionCommand("git branch")).toBe(false);
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
    expect(
      getNestedToolBlockReason({
        recipient_name: "functions.bash",
        parameters: { command: "git status; rm -rf" },
      }),
    ).toBe("Ayu write gate blocked nested tool functions.bash while locked.");

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
    expect(isRecord(undefined)).toBe(false);
    expect(getStringField({ name: "ayu" }, "name")).toBe("ayu");
    expect(getStringField({ name: 1 }, "name")).toBeUndefined();
    expect(getStringField(null, "name")).toBeUndefined();
    expect(getArrayField({ items: ["a"] }, "items")).toEqual(["a"]);
    expect(getArrayField({ items: "a" }, "items")).toBeUndefined();
    expect(getArrayField(null, "items")).toBeUndefined();
    expect(dangerousShellSyntaxPattern.test("git status && git diff")).toBe(true);
    expect(dangerousShellSyntaxPattern.test("git status")).toBe(false);
  });

  test("classifies bash risk tiers correctly", () => {
    expect(classifyBashRiskTier("git push origin main")).toBe("T4");
    expect(classifyBashRiskTier("npm publish")).toBe("T4");
    expect(classifyBashRiskTier("pnpm run release")).toBe("T4");
    expect(classifyBashRiskTier("kubectl apply -f deployment.yaml")).toBe("T4");
    expect(classifyBashRiskTier("terraform apply")).toBe("T4");

    expect(classifyBashRiskTier("rm -rf node_modules")).toBe("T3");
    expect(classifyBashRiskTier("DROP TABLE users")).toBe("T3");
    expect(classifyBashRiskTier("DELETE FROM logs WHERE old")).toBe("T3");
    expect(classifyBashRiskTier("pnpm db:migrate")).toBe("T3");

    expect(classifyBashRiskTier("curl -X POST https://api.example.com")).toBe("T2");
    expect(classifyBashRiskTier("git status")).toBeNull();
    expect(classifyBashRiskTier("pnpm test")).toBeNull();
  });

  test("blocks T4 and T3 commands even when Write Mode is On", () => {
    expect(getWriteModeOnBlockReason("bash", { command: "git push" })).toBe(
      "Blocked T4: production-mutating command requires explicit approval",
    );
    expect(getWriteModeOnBlockReason("bash", { command: "rm -rf dist" })).toBe(
      "Blocked T3: irreversible command requires dry-run/backup/approval",
    );

    // T0/T1 commands remain allowed
    expect(getWriteModeOnBlockReason("bash", { command: "git status" })).toBeUndefined();
    expect(getWriteModeOnBlockReason("bash", { command: "pnpm test" })).toBeUndefined();
    expect(getWriteModeOnBlockReason("read", { path: "README.md" })).toBeUndefined();
    expect(getWriteModeOnBlockReason("edit", { path: "README.md" })).toBeUndefined();
  });

  test("classifyBashRiskTier respects custom rules", () => {
    const customRules: RiskRule[] = [
      { pattern: "dangerous-command", tier: "T4" },
      { pattern: "risky-op", tier: "T3" },
    ];
    expect(classifyBashRiskTier("run dangerous-command now", customRules)).toBe("T4");
    expect(classifyBashRiskTier("risky-op --force", customRules)).toBe("T3");
    expect(classifyBashRiskTier("git push", customRules)).toBeNull();
    expect(classifyBashRiskTier("safe command", customRules)).toBeNull();
  });

  test("custom rules override defaults when provided", () => {
    const customRules: RiskRule[] = [{ pattern: "custom-deploy", tier: "T4" }];
    expect(getWriteModeOnBlockReason("bash", { command: "custom-deploy" }, customRules)).toBe(
      "Blocked T4: production-mutating command requires explicit approval",
    );
    expect(getWriteModeOnBlockReason("bash", { command: "git push" }, customRules)).toBeUndefined();
  });

  test("falls back to default rules when custom rules are empty", () => {
    expect(classifyBashRiskTier("git push", [])).toBe("T4");
    expect(getWriteModeOnBlockReason("bash", { command: "git push" }, [])).toBe(
      "Blocked T4: production-mutating command requires explicit approval",
    );
  });

  test("getWriteModeOnBlockReason handles missing command field", () => {
    expect(getWriteModeOnBlockReason("bash", {})).toBeUndefined();
    expect(getWriteModeOnBlockReason("bash", { command: undefined })).toBeUndefined();
  });

  test("getNestedToolBlockReason handles non-record toolUse", () => {
    expect(getNestedToolBlockReason("not-a-record")).toBeUndefined();
  });

  test("getLockedToolBlockReason allows safe mcp actions without tool", () => {
    expect(getLockedToolBlockReason("mcp", { action: "ui-messages" })).toBeUndefined();
    expect(getLockedToolBlockReason("mcp", { server: "codegraph" })).toBeUndefined();
  });

  test("getLockedToolBlockReason blocks mutating mcp tool names", () => {
    expect(getLockedToolBlockReason("mcp", { tool: "write_file" })).toBe(
      "Ayu write gate blocked a potentially mutating MCP call while locked.",
    );
    expect(getLockedToolBlockReason("mcp", { action: "ui-messages", tool: "write_file" })).toBe(
      "Ayu write gate blocked a potentially mutating MCP call while locked.",
    );
  });
});

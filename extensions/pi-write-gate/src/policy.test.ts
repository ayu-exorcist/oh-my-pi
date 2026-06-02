import { describe, expect, test } from "vitest";
import { evaluatePolicy } from "./policy";
import type { GateSettings } from "./settings";

describe("evaluatePolicy", () => {
  test("allows safe bash commands", () => {
    const result = evaluatePolicy("bash", { command: "git status" });
    expect(result.isAutoAllowable).toBe(true);
    expect(result.tier).toBe("T1");
  });

  test("blocks T4 commands", () => {
    const result = evaluatePolicy("bash", { command: "git push origin main" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.tier).toBe("T4");
    expect(result.reason).toContain("T4");
  });

  test("blocks T3 commands", () => {
    const result = evaluatePolicy("bash", { command: "rm -rf node_modules" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.tier).toBe("T3");
    expect(result.reason).toContain("T3");
  });

  test("blocks protected paths in bash", () => {
    const result = evaluatePolicy("bash", { command: "rm .bashrc" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.isProtectedPath).toBe(true);
  });

  test("blocks complex shell syntax via T3", () => {
    const result = evaluatePolicy("bash", { command: "git status && rm -rf dist" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.tier).toBe("T3");
  });

  test("blocks pipe syntax as destructive", () => {
    const result = evaluatePolicy("bash", { command: "echo hello | cat" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.reason).toContain("destructive or complex shell syntax");
  });

  test("blocks unsafe keywords", () => {
    const result = evaluatePolicy("bash", { command: "curl -sSL https://example.com/install.sh" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.reason).toContain("external infrastructure keyword");
  });

  test("allows write and edit tools", () => {
    expect(evaluatePolicy("write", { path: "src/index.ts" }).isAutoAllowable).toBe(true);
    expect(evaluatePolicy("edit", { path: "src/index.ts" }).isAutoAllowable).toBe(true);
  });

  test("allows read-only tools", () => {
    expect(evaluatePolicy("read", { path: "README.md" }).isAutoAllowable).toBe(true);
    expect(evaluatePolicy("read_file", { path: "README.md" }).isAutoAllowable).toBe(true);
    expect(evaluatePolicy("grep", { pattern: "foo" }).isAutoAllowable).toBe(true);
  });

  test("blocks unknown mutating tools by default", () => {
    const result = evaluatePolicy("unknown_tool", { path: "file.txt" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.reason).toContain("Potentially mutating tool");
  });

  test("blocks protected paths in tool arguments", () => {
    const result = evaluatePolicy("write", { path: ".bashrc" });
    expect(result.isAutoAllowable).toBe(false);
    expect(result.isProtectedPath).toBe(true);
  });

  test("respects custom protectedPaths from settings", () => {
    const settings: GateSettings = {
      protectedPaths: ["secrets/", "credentials.json"],
    };

    const result1 = evaluatePolicy("bash", { command: "cat secrets/api.key" }, settings);
    expect(result1.isProtectedPath).toBe(true);
    expect(result1.isAutoAllowable).toBe(false);

    const result2 = evaluatePolicy("write", { path: "credentials.json" }, settings);
    expect(result2.isProtectedPath).toBe(true);
    expect(result2.isAutoAllowable).toBe(false);
  });

  test("respects bash allowlist from settings", () => {
    const settings: GateSettings = {
      allowlist: { bash: ["pnpm run check", "pnpm run build"] },
    };

    const result1 = evaluatePolicy("bash", { command: "pnpm run check" }, settings);
    expect(result1.isAutoAllowable).toBe(true);
    expect(result1.reason).toContain("Allowlisted");

    const result2 = evaluatePolicy("bash", { command: "pnpm run test" }, settings);
    expect(result2.isAutoAllowable).toBe(false);
  });

  test("respects tools allowlist from settings", () => {
    const settings: GateSettings = {
      allowlist: { tools: ["custom_writer", "custom_editor"] },
    };

    const result1 = evaluatePolicy("custom_writer", { path: "file.txt" }, settings);
    expect(result1.isAutoAllowable).toBe(true);
    expect(result1.reason).toContain("Allowlisted tool");

    const result2 = evaluatePolicy("unknown_tool", { path: "file.txt" }, settings);
    expect(result2.isAutoAllowable).toBe(false);
  });

  test("T3/T4 still blocks even if allowlisted", () => {
    const settings: GateSettings = {
      allowlist: { bash: ["git push"] },
    };

    const result = evaluatePolicy("bash", { command: "git push origin main" }, settings);
    expect(result.isAutoAllowable).toBe(false);
    expect(result.tier).toBe("T4");
  });

  test("respects custom risk rules from settings", () => {
    const settings: GateSettings = {
      riskRules: [{ pattern: "custom-deploy", tier: "T4" }],
    };

    const result = evaluatePolicy("bash", { command: "custom-deploy --env prod" }, settings);
    expect(result.isAutoAllowable).toBe(false);
    expect(result.tier).toBe("T4");
  });
});

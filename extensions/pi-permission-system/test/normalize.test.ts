import { describe, expect, test } from "vitest";
import { normalizeFlatConfig } from "#src/normalize";

describe("normalizeFlatConfig", () => {
  describe("string shorthand", () => {
    test("string value produces a single catch-all rule for the surface", () => {
      const result = normalizeFlatConfig({ read: "allow" });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });

    test("string shorthand works for multiple surfaces", () => {
      const result = normalizeFlatConfig({ read: "allow", write: "deny" });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
        { surface: "write", pattern: "*", action: "deny", origin: "builtin" },
      ]);
    });

    test("universal fallback '*' becomes a catch-all rule with surface '*'", () => {
      const result = normalizeFlatConfig({ "*": "ask" });
      expect(result).toEqual([{ surface: "*", pattern: "*", action: "ask", origin: "builtin" }]);
    });

    test("external_directory string shorthand maps directly to its surface", () => {
      const result = normalizeFlatConfig({ external_directory: "ask" });
      expect(result).toEqual([
        {
          surface: "external_directory",
          pattern: "*",
          action: "ask",
          origin: "builtin",
        },
      ]);
    });

    test("invalid string values (non-PermissionState) are ignored", () => {
      const result = normalizeFlatConfig({
        read: "allow",
        write: "invalid" as never,
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });
  });

  describe("object pattern map", () => {
    test("object value produces one rule per pattern", () => {
      const result = normalizeFlatConfig({
        bash: { "*": "ask", "git *": "allow" },
      });
      expect(result).toEqual([
        { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("mcp object map produces rules with surface 'mcp'", () => {
      const result = normalizeFlatConfig({
        mcp: { "*": "ask", mcp_status: "allow" },
      });
      expect(result).toEqual([
        { surface: "mcp", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "mcp",
          pattern: "mcp_status",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("skill object map produces rules with surface 'skill'", () => {
      const result = normalizeFlatConfig({
        skill: { "*": "ask", librarian: "allow" },
      });
      expect(result).toEqual([
        { surface: "skill", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "skill",
          pattern: "librarian",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });

    test("invalid action values in object map are ignored", () => {
      const result = normalizeFlatConfig({
        bash: { "git *": "allow", "rm -rf *": "bad" as never },
      });
      expect(result).toEqual([
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
      ]);
    });
  });

  describe("mixed surfaces", () => {
    test("full mixed config produces rules in insertion order", () => {
      const result = normalizeFlatConfig({
        "*": "ask",
        read: "allow",
        write: "deny",
        bash: { "*": "ask", "git *": "allow" },
        mcp: { mcp_status: "allow" },
        skill: { "*": "ask" },
        external_directory: "ask",
      });
      expect(result).toEqual([
        { surface: "*", pattern: "*", action: "ask", origin: "builtin" },
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
        { surface: "write", pattern: "*", action: "deny", origin: "builtin" },
        { surface: "bash", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "bash",
          pattern: "git *",
          action: "allow",
          origin: "builtin",
        },
        {
          surface: "mcp",
          pattern: "mcp_status",
          action: "allow",
          origin: "builtin",
        },
        { surface: "skill", pattern: "*", action: "ask", origin: "builtin" },
        {
          surface: "external_directory",
          pattern: "*",
          action: "ask",
          origin: "builtin",
        },
      ]);
    });
  });

  describe("empty and edge cases", () => {
    test("empty permission object produces empty ruleset", () => {
      expect(normalizeFlatConfig({})).toEqual([]);
    });

    test("non-object values (null, array) nested in map are skipped", () => {
      const result = normalizeFlatConfig({
        bash: null as never,
        read: "allow",
      });
      expect(result).toEqual([
        { surface: "read", pattern: "*", action: "allow", origin: "builtin" },
      ]);
    });
  });
});

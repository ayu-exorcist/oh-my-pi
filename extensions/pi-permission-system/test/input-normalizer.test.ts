import { describe, expect, it } from "vitest";
import { buildInputForSurface, normalizeInput } from "#src/input-normalizer";
import { createMcpPermissionTargets } from "#src/mcp-targets";

describe("buildInputForSurface", () => {
  it("builds surface-specific input payloads from values", () => {
    expect(buildInputForSurface("bash", "git status")).toEqual({ command: "git status" });
    expect(buildInputForSurface("skill", "librarian")).toEqual({ name: "librarian" });
    expect(buildInputForSurface("external_directory", "/outside")).toEqual({ path: "/outside" });
    expect(buildInputForSurface("mcp", "exa:search")).toEqual({});
  });

  it("defaults missing values to empty strings", () => {
    expect(buildInputForSurface("bash", undefined)).toEqual({ command: "" });
  });
});

describe("normalizeInput — non-MCP surfaces", () => {
  describe("special / path", () => {
    it("uses path from input as the lookup value", () => {
      const result = normalizeInput("path", { path: ".env" }, []);
      expect(result.surface).toBe("path");
      expect(result.values).toEqual([".env"]);
      expect(result.resultExtras).toEqual({});
    });

    it("falls back to '*' when path is missing", () => {
      const result = normalizeInput("path", {}, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when path is not a string", () => {
      const result = normalizeInput("path", { path: 42 }, []);
      expect(result.values).toEqual(["*"]);
    });

    it("handles null input", () => {
      const result = normalizeInput("path", null, []);
      expect(result.values).toEqual(["*"]);
    });
  });

  describe("special / external_directory", () => {
    it("uses path from input as the lookup value", () => {
      const result = normalizeInput("external_directory", { path: "/other/project" }, []);
      expect(result.surface).toBe("external_directory");
      expect(result.values).toEqual(["/other/project"]);
      expect(result.resultExtras).toEqual({});
    });

    it("falls back to '*' when path is missing", () => {
      const result = normalizeInput("external_directory", {}, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when path is not a string", () => {
      const result = normalizeInput("external_directory", { path: 42 }, []);
      expect(result.values).toEqual(["*"]);
    });

    it("handles null input", () => {
      const result = normalizeInput("external_directory", null, []);
      expect(result.values).toEqual(["*"]);
    });
  });

  describe("skill", () => {
    it("uses skill name from input.name", () => {
      const result = normalizeInput("skill", { name: "librarian" }, []);
      expect(result.surface).toBe("skill");
      expect(result.values).toEqual(["librarian"]);
      expect(result.resultExtras).toEqual({});
    });

    it("falls back to '*' when name is missing", () => {
      const result = normalizeInput("skill", {}, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when name is not a string", () => {
      const result = normalizeInput("skill", { name: 99 }, []);
      expect(result.values).toEqual(["*"]);
    });
  });

  describe("bash", () => {
    it("uses command from input.command", () => {
      const result = normalizeInput("bash", { command: "git status" }, []);
      expect(result.surface).toBe("bash");
      expect(result.values).toEqual(["git status"]);
      expect(result.resultExtras).toEqual({ command: "git status" });
    });

    it("uses empty string when command is missing", () => {
      const result = normalizeInput("bash", {}, []);
      expect(result.values).toEqual([""]);
      expect(result.resultExtras).toEqual({ command: "" });
    });

    it("uses empty string when command is not a string", () => {
      const result = normalizeInput("bash", { command: 42 }, []);
      expect(result.values).toEqual([""]);
      expect(result.resultExtras).toEqual({ command: "" });
    });
  });

  describe("path-bearing tools (read, write, edit, grep, find, ls)", () => {
    it("uses input.path as the lookup value when path is present", () => {
      for (const tool of ["read", "write", "edit", "grep", "find", "ls"]) {
        const result = normalizeInput(tool, { path: "/project/src/main.ts" }, []);
        expect(result.surface).toBe(tool);
        expect(result.values).toEqual(["/project/src/main.ts"]);
        expect(result.resultExtras).toEqual({});
      }
    });

    it("falls back to '*' when input.path is missing", () => {
      for (const tool of ["read", "write", "edit", "grep", "find", "ls"]) {
        const result = normalizeInput(tool, {}, []);
        expect(result.values).toEqual(["*"]);
      }
    });

    it("falls back to '*' when input.path is empty string", () => {
      const result = normalizeInput("read", { path: "" }, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when input.path is not a string", () => {
      const result = normalizeInput("write", { path: 42 }, []);
      expect(result.values).toEqual(["*"]);
    });

    it("falls back to '*' when input is null", () => {
      const result = normalizeInput("edit", null, []);
      expect(result.values).toEqual(["*"]);
    });
  });

  describe("extension tools (non-path-bearing)", () => {
    it("uses '*' as the lookup value for extension tools", () => {
      const result = normalizeInput("my_extension_tool", { some: "input" }, []);
      expect(result.surface).toBe("my_extension_tool");
      expect(result.values).toEqual(["*"]);
      expect(result.resultExtras).toEqual({});
    });

    it("uses '*' even when extension tool has a path field", () => {
      const result = normalizeInput("my_extension_tool", { path: "/some/path" }, []);
      expect(result.values).toEqual(["*"]);
    });
  });
});

describe("normalizeInput — MCP surface", () => {
  it("surface is 'mcp'", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.surface).toBe("mcp");
  });

  it("values end with the catch-all 'mcp' target", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.values.at(-1)).toBe("mcp");
  });

  it("values include specific targets before the catch-all for a qualified tool call", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.values).toContain("exa_search");
    expect(result.values).toContain("exa:search");
    expect(result.values).toContain("exa");
    expect(result.values).toContain("mcp_call");
    // 'mcp' is always last
    expect(result.values.at(-1)).toBe("mcp");
  });

  it("matches createMcpPermissionTargets output + 'mcp' appended", () => {
    const rawTargets = createMcpPermissionTargets({ tool: "exa:search" }, ["exa"]);
    const result = normalizeInput("mcp", { tool: "exa:search" }, ["exa"]);
    expect(result.values).toEqual([...rawTargets, "mcp"]);
  });

  it("resultExtras.target is the first specific target (most-specific)", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, []);
    expect(result.resultExtras.target).toBe(result.values[0]);
  });

  it("resultExtras.target is 'mcp' when no specific targets are derived", () => {
    // Empty input → only mcp_status then mcp appended
    const result = normalizeInput("mcp", {}, []);
    expect(result.resultExtras.target).toBe("mcp_status");
  });

  it("values contain no duplicates", () => {
    const result = normalizeInput("mcp", { tool: "exa:search" }, ["exa"]);
    const unique = [...new Set(result.values)];
    expect(result.values).toEqual(unique);
  });

  it("produces mcp_status + mcp for status input", () => {
    const result = normalizeInput("mcp", {}, []);
    expect(result.values).toEqual(["mcp_status", "mcp"]);
  });

  it("produces connect targets + mcp for connect input", () => {
    const result = normalizeInput("mcp", { connect: "exa" }, []);
    expect(result.values).toContain("mcp_connect_exa");
    expect(result.values).toContain("mcp_connect");
    expect(result.values.at(-1)).toBe("mcp");
  });
});

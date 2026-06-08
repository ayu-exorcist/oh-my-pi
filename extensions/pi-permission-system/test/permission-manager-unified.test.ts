/**
 * Integration tests verifying the unified checkPermission() path.
 *
 * Step 5: session rules concatenated into the composed ruleset.
 * Step 6: all five surfaces produce identical decisions to the old branching code.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PermissionManager } from "#src/permission-manager";
import type { Rule, Ruleset } from "#src/rule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Manager backed by a missing config file — universal default is "ask". */
function makeManager(mcpServerNames: readonly string[] = []): PermissionManager {
  return new PermissionManager({
    globalConfigPath: "/nonexistent/config.json",
    agentsDir: "/nonexistent/agents",
    mcpServerNames: [...mcpServerNames],
  });
}

/**
 * Manager backed by a real on-disk config file written to a temp directory.
 * Returns the manager and a cleanup function.
 */
function makeManagerWithConfig(
  permission: Record<string, unknown>,
  mcpServerNames: readonly string[] = [],
): { manager: PermissionManager; cleanup: () => void } {
  const baseDir = mkdtempSync(join(tmpdir(), "pm-unified-test-"));
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const globalConfigPath = join(baseDir, "config.json");
  writeFileSync(globalConfigPath, JSON.stringify({ permission }, null, 2));
  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    mcpServerNames: [...mcpServerNames],
  });
  return {
    manager,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  };
}

const sessionAllow = (surface: string, pattern: string): Rule => ({
  surface,
  pattern,
  action: "allow",
  layer: "session",
  origin: "session",
});

// ---------------------------------------------------------------------------
// Step 5: session rules concatenated — wins over config/default
// ---------------------------------------------------------------------------

describe("checkPermission — session rules", () => {
  it("session rule wins over the universal default (external_directory)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("external_directory", "/other/project")];
    const result = manager.checkPermission(
      "external_directory",
      { path: "/other/project" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("/other/project");
  });

  it("session rule wins over the universal default (skill)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("skill", "librarian")];
    const result = manager.checkPermission("skill", { name: "librarian" }, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("librarian");
  });

  it("session rule wins over the universal default (bash)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("bash", "git status")];
    const result = manager.checkPermission(
      "bash",
      { command: "git status" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("git status");
  });

  it("session rule wins over the universal default (tool — read)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("read", "*")];
    const result = manager.checkPermission("read", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("session rule wins over the universal default (mcp)", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("mcp", "mcp_status")];
    const result = manager.checkPermission("mcp", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  });

  it("no session rules — falls through to default (ask)", () => {
    const manager = makeManager();
    const result = manager.checkPermission("read", {}, undefined, []);
    expect(result.state).toBe("ask");
    expect(result.source).not.toBe("session");
  });

  it("session rule with narrower pattern does not block a broader command not in session", () => {
    const manager = makeManager();
    // Only "git status" is session-approved; "git push" should fall through to default.
    const sessionRules: Ruleset = [sessionAllow("bash", "git status")];
    const result = manager.checkPermission(
      "bash",
      { command: "git push origin main" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("ask");
    expect(result.source).not.toBe("session");
  });

  it("session wildcard pattern matches multiple commands", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [sessionAllow("bash", "git *")];
    const push = manager.checkPermission(
      "bash",
      { command: "git push origin main" },
      undefined,
      sessionRules,
    );
    const status = manager.checkPermission(
      "bash",
      { command: "git status" },
      undefined,
      sessionRules,
    );
    expect(push.state).toBe("allow");
    expect(push.source).toBe("session");
    expect(status.state).toBe("allow");
    expect(status.source).toBe("session");
  });
});

// ---------------------------------------------------------------------------
// Step 6: source field and matchedPattern for all five surfaces
// ---------------------------------------------------------------------------

describe("checkPermission — source derivation and matchedPattern", () => {
  describe("external_directory (special surface)", () => {
    it("source is 'special' for a config-matched path", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        external_directory: { "/trusted/*": "allow" },
      });
      try {
        const result = manager.checkPermission("external_directory", {
          path: "/trusted/repo",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("special");
        expect(result.matchedPattern).toBe("/trusted/*");
      } finally {
        cleanup();
      }
    });

    it("source is 'special' even for a default match (no config rule)", () => {
      const manager = makeManager();
      const result = manager.checkPermission("external_directory", {
        path: "/some/path",
      });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("special");
      expect(result.matchedPattern).toBeUndefined();
    });

    it("matchedPattern is undefined for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("external_directory", {
        path: "/unknown",
      });
      expect(result.matchedPattern).toBeUndefined();
    });
  });

  describe("skill surface", () => {
    it("source is 'skill' for a config-matched skill name", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        skill: { librarian: "allow" },
      });
      try {
        const result = manager.checkPermission("skill", { name: "librarian" });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("skill");
        expect(result.matchedPattern).toBe("librarian");
      } finally {
        cleanup();
      }
    });

    it("source is 'skill' even for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("skill", { name: "unknown" });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("skill");
    });
  });

  describe("bash surface", () => {
    it("source is 'bash' and command is included in result", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        bash: { "git *": "allow" },
      });
      try {
        const result = manager.checkPermission("bash", {
          command: "git status",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("bash");
        expect(result.command).toBe("git status");
        expect(result.matchedPattern).toBe("git *");
      } finally {
        cleanup();
      }
    });

    it("source is 'bash' even for a default match, command is empty string", () => {
      const manager = makeManager();
      const result = manager.checkPermission("bash", {});
      expect(result.source).toBe("bash");
      expect(result.command).toBe("");
      expect(result.matchedPattern).toBeUndefined();
    });
  });

  describe("mcp surface", () => {
    it("source is 'mcp' for a config-matched target", () => {
      const { manager, cleanup } = makeManagerWithConfig(
        { "*": "ask", mcp: { exa_search: "allow" } },
        ["exa"],
      );
      try {
        const result = manager.checkPermission("mcp", {
          tool: "exa:search",
          server: "exa",
        });
        expect(result.state).toBe("allow");
        expect(result.source).toBe("mcp");
        expect(result.matchedPattern).toBe("exa_search");
        expect(result.target).toBeDefined();
      } finally {
        cleanup();
      }
    });

    it("source is 'default' when all targets match only the synthesized default", () => {
      const manager = makeManager();
      const result = manager.checkPermission("mcp", { tool: "exa:search" });
      expect(result.state).toBe("ask");
      expect(result.source).toBe("default");
      expect(result.matchedPattern).toBeUndefined();
    });

    it("target field is set for a matched mcp call", () => {
      const { manager, cleanup } = makeManagerWithConfig(
        { "*": "ask", mcp: { mcp_status: "allow" } },
        [],
      );
      try {
        const result = manager.checkPermission("mcp", {});
        expect(result.target).toBeDefined();
        expect(result.source).toBe("mcp");
      } finally {
        cleanup();
      }
    });
  });

  describe("tool surfaces", () => {
    it("built-in tool: source is always 'tool' (config match)", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        read: "allow",
      });
      try {
        const result = manager.checkPermission("read", {});
        expect(result.state).toBe("allow");
        expect(result.source).toBe("tool");
      } finally {
        cleanup();
      }
    });

    it("built-in tool: source is 'tool' even for a default match", () => {
      const manager = makeManager();
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("ask");
      expect(result.source).toBe("tool");
    });

    it("extension tool: source is 'default' when no config rule matches", () => {
      const manager = makeManager();
      const result = manager.checkPermission("my_custom_tool", {});
      expect(result.state).toBe("ask");
      expect(result.source).toBe("default");
    });

    it("extension tool: source is 'tool' when a config rule matches", () => {
      const { manager, cleanup } = makeManagerWithConfig({
        "*": "ask",
        my_custom_tool: "allow",
      });
      try {
        const result = manager.checkPermission("my_custom_tool", {});
        expect(result.state).toBe("allow");
        expect(result.source).toBe("tool");
      } finally {
        cleanup();
      }
    });
  });

  describe("matchedPattern for session rules across surfaces", () => {
    it("matchedPattern is the session rule pattern for a session match (bash)", () => {
      const manager = makeManager();
      const sessionRules: Ruleset = [sessionAllow("bash", "git *")];
      const result = manager.checkPermission(
        "bash",
        { command: "git status" },
        undefined,
        sessionRules,
      );
      expect(result.matchedPattern).toBe("git *");
      expect(result.source).toBe("session");
    });

    it("matchedPattern is the session rule pattern for a session match (skill)", () => {
      const manager = makeManager();
      const sessionRules: Ruleset = [sessionAllow("skill", "librarian")];
      const result = manager.checkPermission(
        "skill",
        { name: "librarian" },
        undefined,
        sessionRules,
      );
      expect(result.matchedPattern).toBe("librarian");
    });
  });
});

// ---------------------------------------------------------------------------
// Home directory expansion in external_directory patterns
// ---------------------------------------------------------------------------

describe("checkPermission — home path expansion in external_directory rules", () => {
  it("~/glob pattern allows a path under the real home directory", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "ask",
      external_directory: { "~/trusted/*": "allow" },
    });
    try {
      const result = manager.checkPermission("external_directory", {
        path: join(homedir(), "trusted/repo"),
      });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("special");
      expect(result.matchedPattern).toBe("~/trusted/*");
    } finally {
      cleanup();
    }
  });

  it("$HOME/glob pattern allows a path under the real home directory", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "ask",
      external_directory: { "$HOME/trusted/*": "allow" },
    });
    try {
      const result = manager.checkPermission("external_directory", {
        path: join(homedir(), "trusted/repo"),
      });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("special");
      expect(result.matchedPattern).toBe("$HOME/trusted/*");
    } finally {
      cleanup();
    }
  });

  it("~/glob deny rule blocks a path under home", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "allow",
      external_directory: { "~/private/*": "deny" },
    });
    try {
      const result = manager.checkPermission("external_directory", {
        path: join(homedir(), "private/secrets.txt"),
      });
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("~/private/*");
    } finally {
      cleanup();
    }
  });

  it("~/glob pattern does not match a path outside home", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "ask",
      external_directory: { "~/trusted/*": "allow" },
    });
    try {
      const result = manager.checkPermission("external_directory", {
        path: "/tmp/not-home/file",
      });
      // Falls back to the "*": "ask" default — no allow from the ~/trusted/* rule.
      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Rule origin provenance
// ---------------------------------------------------------------------------

/**
 * Build a manager with a global config and an optional project config.
 * Returns the manager and a cleanup function.
 */
function makeManagerWithScopes(
  globalPermission: Record<string, unknown>,
  projectPermission?: Record<string, unknown>,
): { manager: PermissionManager; cleanup: () => void } {
  const baseDir = mkdtempSync(join(tmpdir(), "pm-provenance-test-"));
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });
  const globalConfigPath = join(baseDir, "global-config.json");
  writeFileSync(globalConfigPath, JSON.stringify({ permission: globalPermission }, null, 2));

  let projectGlobalConfigPath: string | undefined;
  if (projectPermission !== undefined) {
    projectGlobalConfigPath = join(baseDir, "project-config.json");
    writeFileSync(
      projectGlobalConfigPath,
      JSON.stringify({ permission: projectPermission }, null, 2),
    );
  }

  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    projectGlobalConfigPath,
  });
  return {
    manager,
    cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
  };
}

describe("checkPermission — rule origin provenance", () => {
  it("single-scope global: config rule has origin 'global'", () => {
    const { manager, cleanup } = makeManagerWithScopes({ read: "allow" });
    try {
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("global");
    } finally {
      cleanup();
    }
  });

  it("single-scope global with pattern map: origin is 'global'", () => {
    const { manager, cleanup } = makeManagerWithScopes({
      bash: { "git *": "allow" },
    });
    try {
      const result = manager.checkPermission("bash", { command: "git status" });
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("global");
    } finally {
      cleanup();
    }
  });

  it("project overrides global: winning rule has origin 'project'", () => {
    const { manager, cleanup } = makeManagerWithScopes({ read: "ask" }, { read: "allow" });
    try {
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("both-object merge: patterns retain their own origins", () => {
    // global defines bash["git *"] = allow; project adds bash["rm *"] = deny.
    // Both patterns should survive with their own origins.
    const { manager, cleanup } = makeManagerWithScopes(
      { bash: { "git *": "allow" } },
      { bash: { "rm *": "deny" } },
    );
    try {
      const gitResult = manager.checkPermission("bash", {
        command: "git status",
      });
      expect(gitResult.state).toBe("allow");
      expect(gitResult.origin).toBe("global");

      const rmResult = manager.checkPermission("bash", {
        command: "rm -rf /",
      });
      expect(rmResult.state).toBe("deny");
      expect(rmResult.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("both-object merge: project pattern overrides global pattern for same key", () => {
    // Both scopes define bash["git *"]; project wins for that pattern.
    const { manager, cleanup } = makeManagerWithScopes(
      { bash: { "git *": "ask" } },
      { bash: { "git *": "allow" } },
    );
    try {
      const result = manager.checkPermission("bash", {
        command: "git status",
      });
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("string replaces object: all patterns from replacing scope get origin 'project'", () => {
    // global defines bash as an object; project replaces with string "allow".
    const { manager, cleanup } = makeManagerWithScopes(
      { bash: { "git *": "ask", "npm *": "ask" } },
      { bash: "allow" },
    );
    try {
      // The catch-all "*" now comes from the project scope.
      const result = manager.checkPermission("bash", {
        command: "anything",
      });
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("object replaces string: all patterns from replacing scope get origin 'project'", () => {
    // global defines read as a string "ask"; project replaces with object.
    const { manager, cleanup } = makeManagerWithScopes({ read: "ask" }, { read: { "*": "allow" } });
    try {
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("no config match: origin is 'builtin' (default layer)", () => {
    // No config — falls back to synthesized default.
    const manager = makeManager();
    const result = manager.checkPermission("read", {});
    expect(result.state).toBe("ask");
    expect(result.origin).toBe("builtin");
  });

  it("session rule: origin is 'session'", () => {
    const manager = makeManager();
    const sessionRules: Ruleset = [
      {
        surface: "read",
        pattern: "*",
        action: "allow",
        layer: "session",
        origin: "session",
      },
    ];
    const result = manager.checkPermission("read", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.origin).toBe("session");
  });

  it("universal fallback (*) set in global config carries origin 'global'", () => {
    const { manager, cleanup } = makeManagerWithScopes({ "*": "allow" });
    try {
      // No explicit surface rule — hits the synthesized default derived from "*".
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("global");
    } finally {
      cleanup();
    }
  });

  it("universal fallback (*) overridden by project carries origin 'project'", () => {
    const { manager, cleanup } = makeManagerWithScopes({ "*": "ask" }, { "*": "allow" });
    try {
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    } finally {
      cleanup();
    }
  });

  it("built-in fallback (no * in any config): origin is 'builtin'", () => {
    // Manager with no config file — built-in "ask" default.
    const manager = makeManager();
    const result = manager.checkPermission("read", {});
    expect(result.state).toBe("ask");
    expect(result.origin).toBe("builtin");
  });
});

// ---------------------------------------------------------------------------
// In-memory PolicyLoader stub tests — no filesystem required
// ---------------------------------------------------------------------------

import type { PolicyLoader } from "#src/permission-manager";
import type { ResolvedPolicyPaths } from "#src/policy-loader";
import type { ScopeConfig } from "#src/types";

/**
 * Minimal in-memory PolicyLoader for testing merge + evaluation logic
 * without touching the filesystem.
 */
function createInMemoryPolicyLoader(
  scopes: {
    global?: ScopeConfig;
    project?: ScopeConfig;
    agent?: Record<string, ScopeConfig>;
    projectAgent?: Record<string, ScopeConfig>;
  } = {},
  mcpServerNames: readonly string[] = [],
): PolicyLoader {
  const issues: string[] = [];
  return {
    loadGlobalConfig: () => scopes.global ?? ({} as const),
    loadProjectConfig: () => scopes.project ?? ({} as const),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || is intentional: handles both falsy name and missing key
    loadAgentConfig: (name?: string) => (name && scopes.agent?.[name]) || {},
    loadProjectAgentConfig: (name?: string) =>
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || is intentional: handles both falsy name and missing key
      (name && scopes.projectAgent?.[name]) || {},
    getConfiguredMcpServerNames: () => mcpServerNames,
    getCacheStamp: () => "in-memory",
    getConfigIssues: () => issues,
    getResolvedPolicyPaths: (): ResolvedPolicyPaths => ({
      globalConfigPath: "/in-memory/config.json",
      globalConfigExists: true,
      projectConfigPath: null,
      projectConfigExists: false,
      agentsDir: "/in-memory/agents",
      agentsDirExists: false,
      projectAgentsDir: null,
      projectAgentsDirExists: false,
    }),
  };
}

/** Create a PermissionManager backed by an in-memory PolicyLoader. */
function makeInMemoryManager(
  scopes: Parameters<typeof createInMemoryPolicyLoader>[0] = {},
  mcpServerNames: readonly string[] = [],
): PermissionManager {
  return new PermissionManager({
    policyLoader: createInMemoryPolicyLoader(scopes, mcpServerNames),
  });
}

describe("PermissionManager with in-memory PolicyLoader", () => {
  describe("loader metadata", () => {
    it("exposes config issues, resolved policy paths, and policy cache stamp", () => {
      const manager = makeInMemoryManager();
      expect(manager.getConfigIssues()).toEqual([]);
      expect(manager.getPolicyCacheStamp()).toBe("in-memory");
      expect(manager.getResolvedPolicyPaths()).toEqual(
        expect.objectContaining({
          globalConfigPath: "/in-memory/config.json",
          agentsDir: "/in-memory/agents",
        }),
      );
    });
  });

  describe("universal fallback", () => {
    it("defaults to ask when no config is provided", () => {
      const manager = makeInMemoryManager();
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("ask");
      expect(result.origin).toBe("builtin");
    });

    it("respects permission['*'] = 'allow' from global config", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "allow" } },
      });
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("global");
    });

    it("respects permission['*'] = 'deny' from global config", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "deny" } },
      });
      const result = manager.checkPermission("write", {});
      expect(result.state).toBe("deny");
    });
  });

  describe("surface routing", () => {
    it("bash surface routes correctly", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: { "*": "ask", bash: { "git *": "allow" } },
        },
      });
      const result = manager.checkPermission("bash", {
        command: "git status",
      });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("bash");
      expect(result.matchedPattern).toBe("git *");
      expect(manager.getToolPermission(" bash ")).toBe("ask");
    });

    it("tool-level mcp and skill permissions route through their catch-all surfaces", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: {
            "*": "deny",
            mcp: { "*": "allow" },
            skill: { "*": "ask" },
          },
        },
      });
      expect(manager.getToolPermission("mcp")).toBe("allow");
      expect(manager.getToolPermission("skill")).toBe("ask");
    });

    it("tool surface routes correctly for built-in tools", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "deny", read: "allow" } },
      });
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.source).toBe("tool");
    });

    it("tool surface routes correctly for object pattern maps", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "ask", read: { "src/*": "allow" } } },
      });
      const result = manager.checkPermission("read", { path: "src/index.ts" });
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("global");
      expect(result.matchedPattern).toBe("src/*");
    });

    it("skill surface routes correctly", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: { "*": "ask", skill: { librarian: "allow" } },
        },
      });
      const result = manager.checkPermission("skill", { name: "librarian" });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("skill");
    });

    it("mcp surface routes correctly", () => {
      const manager = makeInMemoryManager(
        {
          global: {
            permission: { "*": "ask", mcp: { exa_search: "allow" } },
          },
        },
        ["exa"],
      );
      const result = manager.checkPermission("mcp", {
        tool: "exa:search",
        server: "exa",
      });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("mcp");
    });

    it("external_directory surface routes correctly", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: {
            "*": "ask",
            external_directory: { "/trusted/*": "allow" },
          },
        },
      });
      const result = manager.checkPermission("external_directory", {
        path: "/trusted/repo",
      });
      expect(result.state).toBe("allow");
      expect(result.source).toBe("special");
    });

    it("extension tools use 'default' source when no config rule matches", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "ask" } },
      });
      const result = manager.checkPermission("my_custom_tool", {});
      expect(result.state).toBe("ask");
      expect(result.source).toBe("default");
    });
  });

  describe("multi-scope merge", () => {
    it("project overrides global", () => {
      const manager = makeInMemoryManager({
        global: { permission: { read: "ask" } },
        project: { permission: { read: "allow" } },
      });
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    });

    it("agent overrides project", () => {
      const manager = makeInMemoryManager({
        global: { permission: { read: "ask" } },
        project: { permission: { read: "allow" } },
        agent: { coder: { permission: { read: "deny" } } },
      });
      const result = manager.checkPermission("read", {}, "coder");
      expect(result.state).toBe("deny");
      expect(result.origin).toBe("agent");
    });

    it("project-agent overrides agent", () => {
      const manager = makeInMemoryManager({
        global: { permission: { read: "deny" } },
        agent: { coder: { permission: { read: "deny" } } },
        projectAgent: { coder: { permission: { read: "allow" } } },
      });
      const result = manager.checkPermission("read", {}, "coder");
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project-agent");
    });

    it("deep-shallow merge preserves patterns from different scopes", () => {
      const manager = makeInMemoryManager({
        global: { permission: { bash: { "git *": "allow" } } },
        project: { permission: { bash: { "rm *": "deny" } } },
      });
      const gitResult = manager.checkPermission("bash", {
        command: "git status",
      });
      expect(gitResult.state).toBe("allow");
      expect(gitResult.origin).toBe("global");

      const rmResult = manager.checkPermission("bash", {
        command: "rm -rf /",
      });
      expect(rmResult.state).toBe("deny");
      expect(rmResult.origin).toBe("project");
    });

    it("string replaces object in override scope", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: { bash: { "git *": "ask", "npm *": "ask" } },
        },
        project: { permission: { bash: "allow" } },
      });
      const result = manager.checkPermission("bash", { command: "anything" });
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    });
  });

  describe("session rule composition", () => {
    it("session rule wins over config", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "deny" } },
      });
      const sessionRules: Ruleset = [sessionAllow("read", "*")];
      const result = manager.checkPermission("read", {}, undefined, sessionRules);
      expect(result.state).toBe("allow");
      expect(result.source).toBe("session");
    });

    it("session rule does not bleed across surfaces", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "ask" } },
      });
      const sessionRules: Ruleset = [sessionAllow("bash", "git *")];
      const bashResult = manager.checkPermission(
        "bash",
        { command: "git status" },
        undefined,
        sessionRules,
      );
      expect(bashResult.state).toBe("allow");

      const readResult = manager.checkPermission("read", {}, undefined, sessionRules);
      expect(readResult.state).toBe("ask");
    });
  });

  describe("origin tracking", () => {
    it("universal fallback from project carries origin 'project'", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "ask" } },
        project: { permission: { "*": "allow" } },
      });
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
      expect(result.origin).toBe("project");
    });

    it("session origin is 'session'", () => {
      const manager = makeInMemoryManager();
      const sessionRules: Ruleset = [sessionAllow("read", "*")];
      const result = manager.checkPermission("read", {}, undefined, sessionRules);
      expect(result.origin).toBe("session");
    });
  });

  describe("getToolPermission", () => {
    it("returns tool-level state for built-in tools", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "deny", read: "allow" } },
      });
      expect(manager.getToolPermission("read")).toBe("allow");
      expect(manager.getToolPermission("write")).toBe("deny");
    });

    it("returns tool-level state for bash surface", () => {
      const manager = makeInMemoryManager({
        global: { permission: { "*": "deny", bash: "allow" } },
      });
      expect(manager.getToolPermission("bash")).toBe("allow");
    });
  });

  describe("getComposedConfigRules", () => {
    it("returns only config-layer rules", () => {
      const manager = makeInMemoryManager({
        global: {
          permission: { "*": "ask", bash: { "git *": "allow" } },
        },
      });
      const rules = manager.getComposedConfigRules();
      expect(rules.every((r) => r.layer === "config")).toBe(true);
      expect(rules.some((r) => r.surface === "bash" && r.pattern === "git *")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Per-tool path patterns (#147)
// ---------------------------------------------------------------------------

describe("checkPermission — per-tool path patterns", () => {
  it("denies read of .env when path pattern matches", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: { "*": "allow", "*.env": "deny" },
    });
    try {
      const result = manager.checkPermission("read", { path: ".env" });
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("*.env");
    } finally {
      cleanup();
    }
  });

  it("allows read of non-.env file when .env is denied", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: { "*": "allow", "*.env": "deny" },
    });
    try {
      const result = manager.checkPermission("read", {
        path: "src/main.ts",
      });
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("allows write to src/ when only src/ is allowed", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      write: { "*": "deny", "src/*": "allow" },
    });
    try {
      const result = manager.checkPermission("write", {
        path: "src/main.ts",
      });
      expect(result.state).toBe("allow");
      expect(result.matchedPattern).toBe("src/*");
    } finally {
      cleanup();
    }
  });

  it("denies write outside src/ when only src/ is allowed", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      write: { "*": "deny", "src/*": "allow" },
    });
    try {
      const result = manager.checkPermission("write", {
        path: "vendor/lib.ts",
      });
      expect(result.state).toBe("deny");
    } finally {
      cleanup();
    }
  });

  it("backward compat: 'read': 'allow' allows read of any path", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: "allow",
    });
    try {
      const result = manager.checkPermission("read", { path: ".env" });
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("backward compat: 'read': 'deny' denies read of any path", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: "deny",
    });
    try {
      const result = manager.checkPermission("read", {
        path: "src/main.ts",
      });
      expect(result.state).toBe("deny");
    } finally {
      cleanup();
    }
  });

  it("session rule for specific path overrides config deny", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: { "*": "allow", "*.env": "deny" },
    });
    try {
      const sessionRules: Ruleset = [sessionAllow("read", ".env")];
      const result = manager.checkPermission("read", { path: ".env" }, undefined, sessionRules);
      expect(result.state).toBe("allow");
      expect(result.source).toBe("session");
    } finally {
      cleanup();
    }
  });

  it("falls back to '*' when input.path is missing", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: { "*": "allow", "*.env": "deny" },
    });
    try {
      const result = manager.checkPermission("read", {});
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("getToolPermission still returns surface-level state (not path-specific)", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: { "*": "allow", "*.env": "deny" },
    });
    try {
      const toolState = manager.getToolPermission("read");
      expect(toolState).toBe("allow");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting path surface (#148)
// ---------------------------------------------------------------------------

describe("cross-cutting path surface", () => {
  it("denies .env via the path surface", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow", "*.env": "deny" },
      read: "allow",
    });
    try {
      const result = manager.checkPermission("path", { path: ".env" });
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("*.env");
    } finally {
      cleanup();
    }
  });

  it("allows non-matching paths via the path surface", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow", "*.env": "deny" },
      read: "allow",
    });
    try {
      const result = manager.checkPermission("path", { path: "README.md" });
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("path surface does not interfere with per-tool rules", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow" },
      read: { "*": "allow", "*.secret": "deny" },
    });
    try {
      // path surface allows, per-tool denies
      const readResult = manager.checkPermission("read", {
        path: "data.secret",
      });
      expect(readResult.state).toBe("deny");
      // path surface also allows
      const pathResult = manager.checkPermission("path", {
        path: "data.secret",
      });
      expect(pathResult.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("getToolPermission('path') returns catch-all action", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow", "*.env": "deny" },
    });
    try {
      const toolState = manager.getToolPermission("path");
      expect(toolState).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("session approval on path surface overrides config deny", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow", "*.env": "deny" },
    });
    try {
      const sessionRules: Ruleset = [sessionAllow("path", "/project/.env")];
      const result = manager.checkPermission(
        "path",
        { path: "/project/.env" },
        undefined,
        sessionRules,
      );
      expect(result.state).toBe("allow");
      expect(result.source).toBe("session");
    } finally {
      cleanup();
    }
  });

  it("configs without path key behave identically (no path gate fires)", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      read: "allow",
    });
    try {
      // path surface falls through to universal default
      const result = manager.checkPermission("path", { path: ".env" });
      expect(result.state).toBe("ask");
    } finally {
      cleanup();
    }
  });

  it("universal default produces undefined matchedPattern for gate skip (#58)", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "ask",
      read: "allow",
      find: "allow",
    });
    try {
      // No explicit "path" key → matchedPattern must be undefined so the
      // path gate skips (describePathGate returns null).
      const result = manager.checkPermission("path", {
        path: "src/main.ts",
      });
      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBeUndefined();

      // Meanwhile the tool-level check should allow read.
      const readResult = manager.checkPermission("read", {
        path: "src/main.ts",
      });
      expect(readResult.state).toBe("allow");
      expect(readResult.matchedPattern).toBe("*");
    } finally {
      cleanup();
    }
  });

  // ── Last-match-wins ordering ────────────────────────────────────────────

  it("last-match-wins: catch-all after deny overrides the deny", () => {
    // Classic misconfiguration: deny is before allow, so allow wins.
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*.env": "deny", "*": "allow" },
    });
    try {
      const result = manager.checkPermission("path", { path: ".env" });
      // "*" is last and matches .env → allow (the deny is shadowed)
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("last-match-wins: deny after catch-all blocks the path", () => {
    // Correct ordering: catch-all first, specific deny after.
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow", "*.env": "deny" },
    });
    try {
      const result = manager.checkPermission("path", { path: ".env" });
      expect(result.state).toBe("deny");
    } finally {
      cleanup();
    }
  });

  // ── .env.example override recipe ────────────────────────────────────────

  it(".env.example override: denies .env and .env.local, allows .env.example", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        "*.env.example": "allow",
      },
    });
    try {
      expect(manager.checkPermission("path", { path: ".env" }).state).toBe("deny");
      expect(manager.checkPermission("path", { path: ".env.local" }).state).toBe("deny");
      expect(manager.checkPermission("path", { path: ".env.production" }).state).toBe("deny");
      expect(manager.checkPermission("path", { path: "src/.env" }).state).toBe("deny");
      expect(manager.checkPermission("path", { path: ".env.example" }).state).toBe("allow");
      expect(manager.checkPermission("path", { path: "README.md" }).state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  // ── Universal fallback interaction ──────────────────────────────────────

  it("universal '*': 'allow' with no path key makes the path gate transparent", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "allow",
    });
    try {
      const result = manager.checkPermission("path", { path: ".env" });
      expect(result.state).toBe("allow");
    } finally {
      cleanup();
    }
  });

  it("universal '*': 'deny' with no path key denies via path surface too", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      "*": "deny",
    });
    try {
      const result = manager.checkPermission("path", { path: ".env" });
      expect(result.state).toBe("deny");
    } finally {
      cleanup();
    }
  });

  // ── Composition: path allows, per-tool denies ──────────────────────────

  it("per-tool deny still blocks even when path surface allows", () => {
    const { manager, cleanup } = makeManagerWithConfig({
      path: { "*": "allow" },
      read: "deny",
    });
    try {
      // path gate passes (allow), but tool gate denies
      const pathResult = manager.checkPermission("path", {
        path: "secret.txt",
      });
      expect(pathResult.state).toBe("allow");
      const readResult = manager.checkPermission("read", {
        path: "secret.txt",
      });
      expect(readResult.state).toBe("deny");
    } finally {
      cleanup();
    }
  });
});

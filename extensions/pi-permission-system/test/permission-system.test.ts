import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

import {
  createActiveToolsCacheKey,
  createBeforeAgentStartPromptStateKey,
  shouldApplyCachedAgentStartState,
} from "#src/before-agent-start-cache";
import { getGlobalConfigPath } from "#src/config-paths";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import piPermissionSystemExtension from "#src/index";
import { createPermissionSystemLogger } from "#src/logging";
import {
  createPermissionForwardingLocation,
  isForwardedPermissionRequestForSession,
  resolvePermissionForwardingTargetSessionId,
  SUBAGENT_ENV_HINT_KEYS,
  SUBAGENT_PARENT_SESSION_ENV_KEY,
} from "#src/permission-forwarding";
import { normalizePathForComparison } from "#src/path-utils";
import { PermissionManager } from "#src/permission-manager";
import {
  findSkillPathMatch,
  parseAllSkillPromptSections,
  resolveSkillPromptEntries,
} from "#src/skill-prompt-sanitizer";
import { getPermissionSystemStatus } from "#src/status";
import { sanitizeAvailableToolsSection } from "#src/system-prompt-sanitizer";
import { checkRequestedToolRegistration, getToolNameFromValue } from "#src/tool-registry";
import type { PermissionCheckResult, PermissionState, ScopeConfig } from "#src/types";
import { canResolveAskPermissionRequest, shouldAutoApprovePermissionState } from "#src/yolo-mode";

type CreateManagerOptions = {
  mcpServerNames?: readonly string[];
};

function createManager(
  config: ScopeConfig,
  agentFiles: Record<string, string> = {},
  options: CreateManagerOptions = {},
) {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-test-"));
  const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
  const agentsDir = join(baseDir, "agents");

  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(globalConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  for (const [name, content] of Object.entries(agentFiles)) {
    writeFileSync(join(agentsDir, `${name}.md`), content, "utf8");
  }

  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    mcpServerNames: options.mcpServerNames,
  });

  return {
    manager,
    globalConfigPath,
    cleanup: (): void => {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

type MockHandler = (
  event: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => Promise<Record<string, unknown> | undefined> | Record<string, unknown> | undefined;

type ExtensionHarness = {
  baseDir: string;
  cwd: string;
  handlers: Record<string, MockHandler>;
  prompts: string[];
  cleanup: () => Promise<void>;
};

type ExtensionHarnessOptions = {
  cwd?: string;
  hasUI?: boolean;
  selectResponse?: string;
  inputResponse?: string;
};

const INHERITED_SUBAGENT_ENV_KEYS = [
  ...SUBAGENT_ENV_HINT_KEYS,
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- test uses deprecated alias intentionally
  SUBAGENT_PARENT_SESSION_ENV_KEY,
] as const;

async function withIsolatedSubagentEnv<T>(operation: () => Promise<T>): Promise<T> {
  const originalValues = new Map<string, string | undefined>();
  for (const key of INHERITED_SUBAGENT_ENV_KEYS) {
    originalValues.set(key, process.env[key]);
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- process.env cleanup requires dynamic delete
    delete process.env[key];
  }

  try {
    return await operation();
  } finally {
    for (const [key, value] of originalValues.entries()) {
      if (value === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- process.env cleanup requires dynamic delete
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createToolCallHarness(
  config: ScopeConfig,
  toolNames: readonly string[],
  options: ExtensionHarnessOptions = {},
): ExtensionHarness {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-runtime-"));
  const cwd = options.cwd ?? baseDir;
  const prompts: string[] = [];
  const handlers: Record<string, MockHandler> = {};
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const globalConfigPath = getGlobalConfigPath(baseDir);
  mkdirSync(join(baseDir, "agents"), { recursive: true });
  mkdirSync(dirname(globalConfigPath), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(
    globalConfigPath,
    `${JSON.stringify({ ...DEFAULT_EXTENSION_CONFIG, ...config }, null, 2)}\n`,
    "utf8",
  );

  process.env.PI_CODING_AGENT_DIR = baseDir;
  try {
    piPermissionSystemExtension({
      on: (name: string, handler: MockHandler): void => {
        handlers[name] = handler;
      },
      registerCommand: (): void => {},
      getAllTools: (): Array<{ name: string }> => toolNames.map((name) => ({ name })),
      setActiveTools: (): void => {},
      registerProvider: (): void => {},
      events: {
        emit: (): void => {},
        on: (): (() => void) => () => undefined,
      },
    } as never);
  } finally {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
  }

  return {
    baseDir,
    cwd,
    handlers,
    prompts,
    cleanup: async (): Promise<void> => {
      await Promise.resolve(
        handlers.session_shutdown({}, createMockContext(cwd, prompts, options)),
      );
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

function createMockContext(
  cwd: string,
  prompts: string[],
  options: ExtensionHarnessOptions = {},
): Record<string, unknown> {
  return {
    cwd,
    hasUI: options.hasUI === true,
    sessionManager: {
      getEntries: (): unknown[] => [],
      getSessionId: (): string => "test-session",
      getSessionDir: (): string => cwd,
    },
    ui: {
      notify: (): void => {},
      setStatus: (): void => {},
      select: async (title: string): Promise<string | undefined> => {
        prompts.push(title);
        return options.selectResponse ?? "Yes";
      },
      input: async (): Promise<string | undefined> => options.inputResponse,
    },
  };
}

async function runToolCall(
  harness: ExtensionHarness,
  event: Record<string, unknown>,
  options: ExtensionHarnessOptions = {},
): Promise<Record<string, unknown>> {
  const handler = harness.handlers.tool_call;
  expect(handler).toBeTypeOf("function");

  const result = await withIsolatedSubagentEnv(async () =>
    Promise.resolve(handler(event, createMockContext(harness.cwd, harness.prompts, options))),
  );
  return result ?? {};
}

test("Yolo mode only auto-approves ask-state permissions", () => {
  expect(shouldAutoApprovePermissionState("ask", DEFAULT_EXTENSION_CONFIG)).toBe(false);
  expect(
    shouldAutoApprovePermissionState("ask", {
      ...DEFAULT_EXTENSION_CONFIG,
      yoloMode: true,
    }),
  ).toBe(true);
  expect(
    shouldAutoApprovePermissionState("deny", {
      ...DEFAULT_EXTENSION_CONFIG,
      yoloMode: true,
    }),
  ).toBe(false);
  expect(
    shouldAutoApprovePermissionState("allow", {
      ...DEFAULT_EXTENSION_CONFIG,
      yoloMode: true,
    }),
  ).toBe(false);
});

test("Yolo mode resolves ask permissions without UI or delegation forwarding", () => {
  expect(
    canResolveAskPermissionRequest({
      config: DEFAULT_EXTENSION_CONFIG,
      hasUI: false,
      isSubagent: false,
    }),
  ).toBe(false);
  expect(
    canResolveAskPermissionRequest({
      config: { ...DEFAULT_EXTENSION_CONFIG, yoloMode: true },
      hasUI: false,
      isSubagent: false,
    }),
  ).toBe(true);
  expect(
    canResolveAskPermissionRequest({
      config: DEFAULT_EXTENSION_CONFIG,
      hasUI: false,
      isSubagent: true,
    }),
  ).toBe(true);
});

test("Permission-system status is only exposed when yolo mode is enabled", () => {
  expect(getPermissionSystemStatus(DEFAULT_EXTENSION_CONFIG)).toBe(undefined);
  expect(getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true })).toBe("yolo");
});

test("System prompt sanitizer removes the Available tools section and surrounding boilerplate", () => {
  const prompt = [
    "Available tools:",
    "- read: Read file contents",
    "- mcp: Discover, inspect, and call MCP tools across configured servers",
    "",
    "In addition to the tools above, you may have access to other custom tools depending on the project.",
    "",
    "Guidelines:",
    "- Use mcp for MCP discovery first: search by capability, describe one exact tool name, then call it.",
    "- Be concise in your responses",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["read", "mcp"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).not.toContain("Available tools:");
  expect(result.prompt).not.toContain("In addition to the tools above");
  expect(result.prompt).toMatch(/Guidelines:/);
  expect(result.prompt).toMatch(/Use mcp for MCP discovery first/i);
});

test("System prompt sanitizer removes denied tool guidelines while keeping global guidance", () => {
  const prompt = [
    "Guidelines:",
    "- Use task when work SHOULD be delegated to one or more specialized agents instead of handled entirely in the current session.",
    "- Use mcp for MCP discovery first: search by capability, describe one exact tool name, then call it.",
    "- Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
    "- Be concise in your responses",
    "- Show file paths clearly when working with files",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["bash", "grep", "mcp"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).not.toContain("Use task when work SHOULD");
  expect(result.prompt).toMatch(/Use mcp for MCP discovery first/i);
  expect(result.prompt).toMatch(/Prefer grep\/find\/ls tools over bash/i);
  expect(result.prompt).toMatch(/Be concise in your responses/);
  expect(result.prompt).toMatch(/Show file paths clearly when working with files/);
});

test("System prompt sanitizer removes inactive built-in write guidance", () => {
  const prompt = [
    "Guidelines:",
    "- Use write only for new files or complete rewrites",
    "- When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did",
    "- Be concise in your responses",
  ].join("\n");

  const result = sanitizeAvailableToolsSection(prompt, ["read"]);

  expect(result.removed).toBe(true);
  expect(result.prompt).not.toContain("Use write only for new files or complete rewrites");
  expect(result.prompt).not.toContain("do NOT use cat or bash to display what you did");
  expect(result.prompt).toMatch(/Be concise in your responses/);
});

test("Before-agent-start cache dedupes unchanged active-tool exposure and prompt state", () => {
  const allowedTools = ["read", "mcp"];
  const activeToolsKey = createActiveToolsCacheKey(allowedTools);
  const promptStateKey = createBeforeAgentStartPromptStateKey({
    agentName: "code",
    cwd: "C:/workspace/project",
    permissionStamp: "permissions-v1",
    systemPrompt: "Available tools:\n- read\n- mcp",
    allowedToolNames: allowedTools,
  });

  expect(shouldApplyCachedAgentStartState(null, activeToolsKey)).toBe(true);
  expect(shouldApplyCachedAgentStartState(activeToolsKey, activeToolsKey)).toBe(false);
  expect(shouldApplyCachedAgentStartState(null, promptStateKey)).toBe(true);
  expect(shouldApplyCachedAgentStartState(promptStateKey, promptStateKey)).toBe(false);
});

test("Before-agent-start prompt cache invalidates on permission changes while runtime enforcement stays authoritative", () => {
  const { manager, globalConfigPath, cleanup } = createManager({
    permission: { "*": "allow", write: "deny" },
  });

  try {
    const baselineStamp = manager.getPolicyCacheStamp();
    const baselineKey = createBeforeAgentStartPromptStateKey({
      agentName: null,
      cwd: "C:/workspace/project",
      permissionStamp: baselineStamp,
      systemPrompt: "Available tools:\n- read\n- write",
      allowedToolNames: ["read"],
    });

    expect(shouldApplyCachedAgentStartState(baselineKey, baselineKey)).toBe(false);
    expect(manager.checkPermission("write", {}, undefined).state).toBe("deny");

    const updatedConfig = `${JSON.stringify(
      { permission: { "*": "allow", write: "allow" } },
      null,
      2,
    )}\n`;

    let updatedStamp = baselineStamp;
    for (let attempt = 0; attempt < 10 && updatedStamp === baselineStamp; attempt += 1) {
      const waitUntil = Date.now() + 2;
      while (Date.now() < waitUntil) {
        // Wait for the filesystem timestamp granularity to advance.
      }

      writeFileSync(globalConfigPath, updatedConfig, "utf8");
      updatedStamp = manager.getPolicyCacheStamp();
    }

    expect(updatedStamp).not.toBe(baselineStamp);

    const invalidatedKey = createBeforeAgentStartPromptStateKey({
      agentName: null,
      cwd: "C:/workspace/project",
      permissionStamp: updatedStamp,
      systemPrompt: "Available tools:\n- read\n- write",
      allowedToolNames: ["read", "write"],
    });

    expect(shouldApplyCachedAgentStartState(baselineKey, invalidatedKey)).toBe(true);
    expect(manager.checkPermission("write", {}, undefined).state).toBe("allow");
  } finally {
    cleanup();
  }
});

test("Permission-system logger respects debug toggle and keeps review log enabled by default", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-logs-"));
  const logsDir = join(baseDir, "logs");
  const debugLogPath = join(logsDir, "debug.jsonl");
  const reviewLogPath = join(logsDir, "review.jsonl");
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const logger = createPermissionSystemLogger({
    getConfig: () => config,
    debugLogPath,
    reviewLogPath,
    ensureLogsDirectory: () => {
      mkdirSync(logsDir, { recursive: true });
      return undefined;
    },
  });

  try {
    const initialDebugWarning = logger.debug("debug.disabled", {
      sample: true,
    });
    const reviewWarning = logger.review("permission_request.waiting", {
      toolName: "write",
    });

    expect(initialDebugWarning).toBe(undefined);
    expect(reviewWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(false);
    expect(existsSync(reviewLogPath)).toBe(true);

    config.debugLog = true;
    const enabledDebugWarning = logger.debug("debug.enabled", { sample: true });
    expect(enabledDebugWarning).toBe(undefined);
    expect(existsSync(debugLogPath)).toBe(true);
    expect(readFileSync(debugLogPath, "utf8")).toMatch(/debug\.enabled/);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("PermissionManager canonical built-in permission checking", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "deny", read: "allow" },
  });

  try {
    const readResult = manager.checkPermission("read", {});
    expect(readResult.state).toBe("allow");
    expect(readResult.source).toBe("tool");

    const writeResult = manager.checkPermission("write", {});
    expect(writeResult.state).toBe("deny");
    expect(writeResult.source).toBe("tool");
  } finally {
    cleanup();
  }
});

test("multiline bash command resolves to allow via universal fallback", () => {
  // Regression test for #73: node -e "..." with embedded newlines was
  // falling through to the hard-coded 'ask' default because wildcardMatch
  // used /^.*$/ (no dotAll), which does not match '\n'.
  const { manager, cleanup } = createManager({
    permission: {
      "*": "allow",
      bash: { "rm -rf *": "deny", "sudo *": "ask" },
    },
  });

  try {
    const command = "node -e \"\nimport('x').then(() => {\n  console.log('done');\n});\n\"";
    const result = manager.checkPermission("bash", { command });
    expect(result.state).toBe("allow");
  } finally {
    cleanup();
  }
});

test("Bash specific deny patterns override catch-all within the same config", () => {
  // In the flat format, patterns within a surface map are ordered by insertion.
  // Last-match-wins means specific patterns placed AFTER the catch-all override it.
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      bash: { "*": "allow", "rm -rf *": "deny" },
    },
  });

  try {
    const denied = manager.checkPermission("bash", { command: "rm -rf build" });
    expect(denied.state).toBe("deny");
    expect(denied.source).toBe("bash");
    expect(denied.matchedPattern).toBe("rm -rf *");

    const allowed = manager.checkPermission("bash", { command: "echo hello" });
    expect(allowed.state).toBe("allow");
    expect(allowed.source).toBe("bash");
    expect(allowed.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("MCP wildcard matching uses the registered mcp tool", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      mcp: { "*": "deny", "research_*": "ask", "research_query-*": "allow" },
    },
  });

  try {
    const queryDocs = manager.checkPermission("mcp", {
      tool: "research:query-docs",
    });
    expect(queryDocs.state).toBe("allow");
    expect(queryDocs.source).toBe("mcp");
    expect(queryDocs.matchedPattern).toBe("research_query-*");
    expect(queryDocs.target).toBe("research_query-docs");

    const resolve2 = manager.checkPermission("mcp", {
      tool: "research:resolve-context",
    });
    expect(resolve2.state).toBe("ask");
    expect(resolve2.matchedPattern).toBe("research_*");
    expect(resolve2.target).toBe("research_resolve-context");

    const unknown = manager.checkPermission("mcp", { tool: "search:provider" });
    expect(unknown.state).toBe("deny");
    expect(unknown.matchedPattern).toBe("*");
    expect(unknown.target).toBe("search_provider");
  } finally {
    cleanup();
  }
});

test("Arbitrary extension tools use exact-name tool permissions instead of MCP fallback", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "deny",
      third_party_tool: "allow",
      mcp: { "*": "deny" },
    },
  });

  try {
    const allowed = manager.checkPermission("third_party_tool", {});
    expect(allowed.state).toBe("allow");
    expect(allowed.source).toBe("tool");

    // another_extension_tool has no explicit rule — falls through to the
    // universal default (permission["*"] = "deny") with source "default".
    const fallback = manager.checkPermission("another_extension_tool", {});
    expect(fallback.state).toBe("deny");
    expect(fallback.source).toBe("default");
  } finally {
    cleanup();
  }
});

test("Skill permission matching", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      skill: {
        "*": "ask",
        "web-*": "deny",
        "requesting-code-review": "allow",
      },
    },
  });

  try {
    const allowed = manager.checkPermission("skill", {
      name: "requesting-code-review",
    });
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("requesting-code-review");
    expect(allowed.source).toBe("skill");

    const denied = manager.checkPermission("skill", {
      name: "web-design-guidelines",
    });
    expect(denied.state).toBe("deny");
    expect(denied.matchedPattern).toBe("web-*");

    const fallback = manager.checkPermission("skill", {
      name: "unknown-skill",
    });
    expect(fallback.state).toBe("ask");
    expect(fallback.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("MCP proxy tool infers server-prefixed aliases from configured server names", () => {
  const { manager, cleanup } = createManager(
    {
      permission: {
        "*": "ask",
        mcp: { "exa_*": "deny", exa_get_code_context_exa: "allow" },
      },
    },
    {},
    {
      mcpServerNames: ["exa"],
    },
  );

  try {
    const result = manager.checkPermission("mcp", {
      tool: "get_code_context_exa",
    });
    expect(result.state).toBe("allow");
    expect(result.source).toBe("mcp");
    expect(result.matchedPattern).toBe("exa_get_code_context_exa");
    expect(result.target).toBe("exa_get_code_context_exa");
  } finally {
    cleanup();
  }
});

test("MCP server names in settings.json are not used — only mcp.json is consulted", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-test-"));
  const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
  const mcpConfigPath = join(baseDir, "mcp.json");
  const settingsJsonPath = join(baseDir, "settings.json");
  const agentsDir = join(baseDir, "agents");
  mkdirSync(agentsDir, { recursive: true });

  const config: ScopeConfig = {
    permission: { "*": "ask", mcp: { "legacy-server_*": "allow" } },
  };

  writeFileSync(globalConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }), "utf8");
  writeFileSync(settingsJsonPath, JSON.stringify({ mcpServers: { "legacy-server": {} } }), "utf8");

  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    globalMcpConfigPath: mcpConfigPath,
  });

  try {
    const result = manager.checkPermission("mcp", {
      tool: "some_tool_legacy-server",
    });
    expect(result.state).toBe("ask");
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});

test("MCP describe mode normalizes qualified tool names without duplicating server prefixes", () => {
  const { manager, cleanup } = createManager(
    {
      permission: {
        "*": "ask",
        mcp: { "exa_*": "deny", exa_web_search_exa: "allow" },
      },
    },
    {},
    {
      mcpServerNames: ["exa"],
    },
  );

  try {
    const result = manager.checkPermission("mcp", {
      describe: "exa:web_search_exa",
      server: "exa",
    });
    expect(result.state).toBe("allow");
    expect(result.source).toBe("mcp");
    expect(result.matchedPattern).toBe("exa_web_search_exa");
    expect(result.target).toBe("exa_web_search_exa");
  } finally {
    cleanup();
  }
});

test("Canonical tools map directly without legacy aliases", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "ask", find: "allow", ls: "deny" },
  });

  try {
    const findResult = manager.checkPermission("find", {});
    expect(findResult.state).toBe("allow");
    expect(findResult.source).toBe("tool");

    const lsResult = manager.checkPermission("ls", {});
    expect(lsResult.state).toBe("deny");
    expect(lsResult.source).toBe("tool");
  } finally {
    cleanup();
  }
});

test("mcp catch-all acts as fallback for unmatched MCP targets", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  mcp: allow
---
`,
    },
  );

  try {
    const result = manager.checkPermission("mcp", { tool: "exa:web_search_exa" }, "reviewer");
    expect(result.state).toBe("allow");
    expect(result.source).toBe("mcp");
    expect(result.target).toBe("exa_web_search_exa");
  } finally {
    cleanup();
  }
});

test("specific MCP rules override mcp catch-all", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  mcp:
    "*": allow
    exa_web_search_exa: deny
---
`,
    },
    {
      mcpServerNames: ["exa"],
    },
  );

  try {
    const result = manager.checkPermission("mcp", { tool: "web_search_exa" }, "reviewer");
    expect(result.state).toBe("deny");
    expect(result.source).toBe("mcp");
    expect(result.matchedPattern).toBe("exa_web_search_exa");
    expect(result.target).toBe("exa_web_search_exa");
  } finally {
    cleanup();
  }
});

test("specific MCP rules still win when mcp catch-all is deny", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  mcp:
    "*": deny
    exa_web_search_exa: allow
---
`,
    },
    {
      mcpServerNames: ["exa"],
    },
  );

  try {
    const allowed = manager.checkPermission("mcp", { tool: "web_search_exa" }, "reviewer");
    expect(allowed.state).toBe("allow");
    expect(allowed.source).toBe("mcp");
    expect(allowed.matchedPattern).toBe("exa_web_search_exa");
    expect(allowed.target).toBe("exa_web_search_exa");

    const fallback = manager.checkPermission("mcp", { tool: "other_exa" }, "reviewer");
    expect(fallback.state).toBe("deny");
    expect(fallback.source).toBe("mcp");
    expect(fallback.target).toBe("exa_other_exa");
  } finally {
    cleanup();
  }
});

test("mcp catch-all in agent frontmatter overrides global default", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "deny" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  mcp: allow
---
`,
    },
  );

  try {
    const readResult = manager.checkPermission("read", {}, "reviewer");
    expect(readResult.state).toBe("deny");
    expect(readResult.source).toBe("tool");

    const mcpResult = manager.checkPermission("mcp", { tool: "exa:web_search_exa" }, "reviewer");
    expect(mcpResult.state).toBe("allow");
    expect(mcpResult.source).toBe("mcp");
  } finally {
    cleanup();
  }
});

test("Agent frontmatter canonical tools resolve correctly", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "deny" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  find: allow
  ls: deny
---
`,
    },
  );

  try {
    const findResult = manager.checkPermission("find", {}, "reviewer");
    expect(findResult.state).toBe("allow");
    expect(findResult.source).toBe("tool");

    const lsResult = manager.checkPermission("ls", {}, "reviewer");
    expect(lsResult.state).toBe("deny");
    expect(lsResult.source).toBe("tool");
  } finally {
    cleanup();
  }
});

test("All surface names work in agent frontmatter flat permission format", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "deny" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  find: allow
  task: allow
  mcp: allow
---
`,
    },
  );

  try {
    const findResult = manager.checkPermission("find", {}, "reviewer");
    expect(findResult.state).toBe("allow");
    expect(findResult.source).toBe("tool");

    // In flat format any surface key works, including extension tools
    const taskResult = manager.checkPermission("task", {}, "reviewer");
    expect(taskResult.state).toBe("allow");
    expect(taskResult.source).toBe("tool");

    // mcp: allow catches all MCP targets
    const mcpResult = manager.checkPermission("mcp", { tool: "exa:web_search_exa" }, "reviewer");
    expect(mcpResult.state).toBe("allow");
  } finally {
    cleanup();
  }
});

test("task uses exact-name tool permissions like any registered extension tool", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "deny", task: "allow" },
  });

  try {
    const taskResult = manager.checkPermission("task", {});
    expect(taskResult.state).toBe("allow");
    expect(taskResult.source).toBe("tool");
  } finally {
    cleanup();
  }
});

test("Tool registry resolves event tool names from string and object payloads", () => {
  expect(getToolNameFromValue("  read  ")).toBe("read");
  expect(getToolNameFromValue({ toolName: "write" })).toBe("write");
  expect(getToolNameFromValue({ name: "find" })).toBe("find");
  expect(getToolNameFromValue({ tool: "grep" })).toBe("grep");
  expect(getToolNameFromValue({})).toBe(null);
});

test("Tool registry blocks unregistered tools and handles aliases", () => {
  const registeredTools = [{ toolName: "mcp" }, { toolName: "read" }, { toolName: "bash" }];

  const unknownCheck = checkRequestedToolRegistration("third_party_tool", registeredTools);
  expect(unknownCheck.status).toBe("unregistered");
  if (unknownCheck.status === "unregistered") {
    expect(unknownCheck.availableToolNames).toEqual(["bash", "mcp", "read"]);
  }

  const aliasCheck = checkRequestedToolRegistration("legacy_read", registeredTools, {
    legacy_read: "read",
  });
  expect(aliasCheck.status).toBe("registered");

  const missingNameCheck = checkRequestedToolRegistration("   ", registeredTools);
  expect(missingNameCheck.status).toBe("missing-tool-name");
});

test("getToolPermission returns tool-level policy for canonical and extension tools", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  bash: deny
  read: deny
  task: allow
---
`,
    },
  );

  try {
    const bashPermission = manager.getToolPermission("bash", "reviewer");
    expect(bashPermission).toBe("deny");

    const taskPermission = manager.getToolPermission("task", "reviewer");
    expect(taskPermission).toBe("allow");

    const readPermission = manager.getToolPermission("read", "reviewer");
    expect(readPermission).toBe("deny");

    const defaultBashPermission = manager.getToolPermission("bash");
    expect(defaultBashPermission).toBe("ask");

    const { manager: manager2, cleanup: cleanup2 } = createManager({
      permission: { "*": "deny", bash: "allow" },
    });

    try {
      const globalBashPermission = manager2.getToolPermission("bash");
      expect(globalBashPermission).toBe("allow");
    } finally {
      cleanup2();
    }
  } finally {
    cleanup();
  }
});

test("getToolPermission supports arbitrary extension tool names", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "deny", third_party_tool: "allow" },
  });

  try {
    const explicitPermission = manager.getToolPermission("third_party_tool");
    expect(explicitPermission).toBe("allow");

    const fallbackPermission = manager.getToolPermission("missing_extension_tool");
    expect(fallbackPermission).toBe("deny");
  } finally {
    cleanup();
  }
});

test("Yolo mode bypasses delegated ask routing when no parent forwarding target is available", () => {
  const targetSessionId = resolvePermissionForwardingTargetSessionId({
    hasUI: false,
    isSubagent: true,
    currentSessionId: "child-session",
    env: {},
  });

  expect(targetSessionId).toBe(null);
  expect(
    canResolveAskPermissionRequest({
      config: { ...DEFAULT_EXTENSION_CONFIG, yoloMode: true },
      hasUI: false,
      isSubagent: true,
    }),
  ).toBe(true);
  expect(
    shouldAutoApprovePermissionState("ask", {
      ...DEFAULT_EXTENSION_CONFIG,
      yoloMode: true,
    }),
  ).toBe(true);
});

test("Permission forwarding resolves the parent interactive session from subagent runtime env", () => {
  const targetSessionId = resolvePermissionForwardingTargetSessionId({
    hasUI: false,
    isSubagent: true,
    currentSessionId: "child-session",
    env: {
      PI_AGENT_ROUTER_PARENT_SESSION_ID: "parent-session",
    },
  });

  expect(targetSessionId).toBe("parent-session");
});

test("Permission forwarding does not guess a target session when subagent runtime env is missing", () => {
  const targetSessionId = resolvePermissionForwardingTargetSessionId({
    hasUI: false,
    isSubagent: true,
    currentSessionId: "child-session",
    env: {},
  });

  expect(targetSessionId).toBe(null);
});

test("Permission forwarding uses session-scoped directories per interactive session", () => {
  const forwardingRoot = join(tmpdir(), "pi-permission-system-forwarding-root");
  const sessionA = createPermissionForwardingLocation(forwardingRoot, "session-a");
  const sessionB = createPermissionForwardingLocation(forwardingRoot, "session-b");

  expect(sessionA.sessionRootDir).not.toBe(sessionB.sessionRootDir);
  expect(sessionA.requestsDir).not.toBe(sessionB.requestsDir);
  expect(sessionA.responsesDir).not.toBe(sessionB.responsesDir);
});

test("Permission forwarding request routing only matches the intended UI session", () => {
  expect(
    isForwardedPermissionRequestForSession({ targetSessionId: "session-a" }, "session-a"),
  ).toBe(true);
  expect(
    isForwardedPermissionRequestForSession({ targetSessionId: "session-a" }, "session-b"),
  ).toBe(false);
});

test("Permission forwarding rejects unresolved sentinel session ids", () => {
  const targetSessionId = resolvePermissionForwardingTargetSessionId({
    hasUI: true,
    isSubagent: false,
    currentSessionId: "unknown",
  });

  expect(targetSessionId).toBe(null);
});

// ---------------------------------------------------------------------------
// Project-level and per-agent config scope tests
// ---------------------------------------------------------------------------

type CreateManagerWithProjectOptions = CreateManagerOptions & {
  projectConfig?: ScopeConfig;
  projectAgentFiles?: Record<string, string>;
};

function createManagerWithProject(
  config: ScopeConfig,
  agentFiles: Record<string, string> = {},
  options: CreateManagerWithProjectOptions = {},
) {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-proj-test-"));
  const globalConfigPath = join(baseDir, "pi-permissions.jsonc");
  const agentsDir = join(baseDir, "agents");
  const projectRoot = join(baseDir, "project");
  const projectGlobalConfigPath = join(projectRoot, "pi-permissions.jsonc");
  const projectAgentsDir = join(projectRoot, "agents");

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(projectAgentsDir, { recursive: true });

  writeFileSync(globalConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (options.projectConfig) {
    writeFileSync(
      projectGlobalConfigPath,
      `${JSON.stringify(options.projectConfig, null, 2)}\n`,
      "utf8",
    );
  }

  for (const [name, content] of Object.entries(agentFiles)) {
    writeFileSync(join(agentsDir, `${name}.md`), content, "utf8");
  }

  for (const [name, content] of Object.entries(options.projectAgentFiles ?? {})) {
    writeFileSync(join(projectAgentsDir, `${name}.md`), content, "utf8");
  }

  const manager = new PermissionManager({
    globalConfigPath,
    agentsDir,
    projectGlobalConfigPath,
    projectAgentsDir,
    mcpServerNames: options.mcpServerNames,
  });

  return {
    manager,
    cleanup: (): void => {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

test("Project-level config overrides base bash patterns", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: {
        "*": "allow",
        bash: { "*": "ask", "rm -rf *": "deny" },
      },
    },
    {},
    {
      projectConfig: {
        permission: { bash: { "rm -rf build": "allow" } },
      },
    },
  );

  try {
    const allowed = manager.checkPermission("bash", {
      command: "rm -rf build",
    });
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("rm -rf build");

    const denied = manager.checkPermission("bash", {
      command: "rm -rf node_modules",
    });
    expect(denied.state).toBe("deny");
    expect(denied.matchedPattern).toBe("rm -rf *");
  } finally {
    cleanup();
  }
});

test("System-agent config overrides project-level bash patterns", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "allow", bash: "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  bash:
    "git log *": allow
---
`,
    },
    {
      projectConfig: {
        permission: { bash: { "git *": "deny" } },
      },
    },
  );

  try {
    const allowed = manager.checkPermission("bash", { command: "git log --oneline" }, "reviewer");
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("git log *");

    const denied = manager.checkPermission("bash", { command: "git status" }, "reviewer");
    expect(denied.state).toBe("deny");
    expect(denied.matchedPattern).toBe("git *");
  } finally {
    cleanup();
  }
});

test("Project-agent config overrides system-agent tool rules", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "ask" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  read: deny
---
`,
    },
    {
      projectAgentFiles: {
        reviewer: `---
name: reviewer
permission:
  read: allow
---
`,
      },
    },
  );

  try {
    const result = manager.checkPermission("read", {}, "reviewer");
    expect(result.state).toBe("allow");
    expect(result.source).toBe("tool");
  } finally {
    cleanup();
  }
});

test("Full precedence chain base < project < system-agent < project-agent for universal default", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "deny" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  "*": ask
---
`,
    },
    {
      projectConfig: {
        permission: { "*": "allow" },
      },
      projectAgentFiles: {
        reviewer: `---
name: reviewer
permission:
  "*": deny
---
`,
      },
    },
  );

  try {
    const reviewerResult = manager.checkPermission("custom_extension_tool", {}, "reviewer");
    expect(reviewerResult.state).toBe("deny");
    expect(reviewerResult.source).toBe("default");

    const globalResult = manager.checkPermission("custom_extension_tool", {});
    expect(globalResult.state).toBe("allow");
    expect(globalResult.source).toBe("default");
  } finally {
    cleanup();
  }
});

test("Project-agent applies even without a matching system-agent file", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "allow" },
    },
    {},
    {
      projectAgentFiles: {
        reviewer: `---
name: reviewer
permission:
  read: deny
---
`,
      },
    },
  );

  try {
    const agentResult = manager.checkPermission("read", {}, "reviewer");
    expect(agentResult.state).toBe("deny");
    expect(agentResult.source).toBe("tool");

    const globalResult = manager.checkPermission("read", {});
    expect(globalResult.state).toBe("allow");
    expect(globalResult.source).toBe("tool");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// PI_CODING_AGENT_DIR support
// ---------------------------------------------------------------------------

test("PermissionManager reads config from PI_CODING_AGENT_DIR when set", () => {
  const baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-envdir-"));
  const agentsDir = join(baseDir, "agents");
  const newConfigPath = getGlobalConfigPath(baseDir);
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dirname(newConfigPath), { recursive: true });

  const config: ScopeConfig = {
    permission: { "*": "deny", read: "allow" },
  };
  writeFileSync(newConfigPath, JSON.stringify(config), "utf8");

  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = baseDir;
  try {
    const manager = new PermissionManager();
    const result = manager.checkPermission("read", {});
    expect(result.state).toBe("allow");

    const result2 = manager.checkPermission("write", {});
    expect(result2.state).toBe("deny");
  } finally {
    if (original !== undefined) {
      process.env.PI_CODING_AGENT_DIR = original;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    rmSync(baseDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Skill prompt sanitization - multi-block regression tests
// ---------------------------------------------------------------------------

test("parseAllSkillPromptSections finds every available_skills block", () => {
  const prompt = [
    "Some preamble",
    "<available_skills>",
    "  <skill>",
    "    <name>skill-one</name>",
    "    <description>First skill</description>",
    "    <location>/path/to/one</location>",
    "  </skill>",
    "</available_skills>",
    "Some content between",
    "<available_skills>",
    "  <skill>",
    "    <name>skill-two</name>",
    "    <description>Second skill</description>",
    "    <location>/path/to/two</location>",
    "  </skill>",
    "</available_skills>",
    "Footer",
  ].join("\n");

  const sections = parseAllSkillPromptSections(prompt);

  expect(sections.length).toBe(2);
  expect(sections[0].entries[0]?.name).toBe("skill-one");
  expect(sections[1].entries[0]?.name).toBe("skill-two");
});

test("REGRESSION: resolveSkillPromptEntries sanitizes every available_skills block", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      skill: { "denied-skill": "deny" },
    },
  });

  try {
    const prompt = [
      "System prompt start",
      "<available_skills>",
      "  <skill>",
      "    <name>visible-skill</name>",
      "    <description>Allowed skill</description>",
      "    <location>/skills/visible/index.ts</location>",
      "  </skill>",
      "  <skill>",
      "    <name>denied-skill</name>",
      "    <description>Denied in first block</description>",
      "    <location>/skills/blocked/one.ts</location>",
      "  </skill>",
      "</available_skills>",
      "Agent identity section",
      "<available_skills>",
      "  <skill>",
      "    <name>denied-skill</name>",
      "    <description>Denied in second block</description>",
      "    <location>/skills/blocked/two.ts</location>",
      "  </skill>",
      "</available_skills>",
      "System prompt end",
    ].join("\n");

    const result = resolveSkillPromptEntries(prompt, manager, null, "/cwd");

    expect(result.prompt).not.toContain("denied-skill");
    expect(result.prompt).toContain("visible-skill");
    expect((result.prompt.match(/<available_skills>/g) ?? []).length).toBe(1);
    expect(result.entries.map((entry) => entry.name)).toEqual(["visible-skill"]);
  } finally {
    cleanup();
  }
});

test("REGRESSION: resolveSkillPromptEntries keeps only visible skills available for path matching", () => {
  const { manager, cleanup } = createManager({
    permission: {
      "*": "ask",
      skill: { "blocked-skill": "deny" },
    },
  });

  try {
    const prompt = [
      "System prompt start",
      "<available_skills>",
      "  <skill>",
      "    <name>blocked-skill</name>",
      "    <description>Blocked skill</description>",
      "    <location>@./skills/blocked/entry.ts</location>",
      "  </skill>",
      "</available_skills>",
      "Middle section",
      "<available_skills>",
      "  <skill>",
      "    <name>visible-skill</name>",
      "    <description>Visible skill</description>",
      "    <location>@./skills/visible/entry.ts</location>",
      "  </skill>",
      "</available_skills>",
      "System prompt end",
    ].join("\n");

    const result = resolveSkillPromptEntries(prompt, manager, null, "/cwd");
    const visiblePath = normalizePathForComparison("./skills/visible/file.ts", "/cwd");
    const blockedPath = normalizePathForComparison("./skills/blocked/file.ts", "/cwd");
    const matchedVisibleSkill = findSkillPathMatch(visiblePath, result.entries);
    const matchedBlockedSkill = findSkillPathMatch(blockedPath, result.entries);

    expect(matchedVisibleSkill?.name).toBe("visible-skill");
    expect(matchedBlockedSkill).toBe(null);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// external_directory special permission
// ---------------------------------------------------------------------------

test("external_directory permission falls back to universal default when not explicitly configured", () => {
  // Empty permission: everything defaults to "ask" (least privilege).
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const result = manager.checkPermission("external_directory", {});
    expect(result.state).toBe("ask");
    expect(result.source).toBe("special");
    expect(result.matchedPattern).toBe(undefined);
  } finally {
    cleanup();
  }
});

test("external_directory permission respects explicit deny", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "deny" },
  });

  try {
    const result = manager.checkPermission("external_directory", {});
    expect(result.state).toBe("deny");
    expect(result.source).toBe("special");
    expect(result.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("external_directory permission can be explicitly allowed", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "allow" },
  });

  try {
    const result = manager.checkPermission("external_directory", {});
    expect(result.state).toBe("allow");
    expect(result.source).toBe("special");
    expect(result.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("external_directory permission respects per-agent override", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    {
      trusted: `---
name: trusted
permission:
  external_directory: allow
---
`,
    },
  );

  try {
    // Global policy denies external_directory
    const globalResult = manager.checkPermission("external_directory", {});
    expect(globalResult.state).toBe("deny");

    // Trusted agent overrides to allow
    const agentResult = manager.checkPermission("external_directory", {}, "trusted");
    expect(agentResult.state).toBe("allow");
    expect(agentResult.source).toBe("special");
  } finally {
    cleanup();
  }
});

test("external_directory permission is not affected by unrelated surface keys", () => {
  // Flat format: unknown surface keys are just rules for that surface.
  // external_directory resolves from its own rule, not from unrelated keys.
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "allow" },
  });

  try {
    // external_directory still resolves from its own entry
    const extResult = manager.checkPermission("external_directory", {});
    expect(extResult.state).toBe("allow");
    expect(extResult.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("skill pattern map in agent frontmatter overrides global skill policy", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "deny", skill: "deny" },
    },
    {
      reviewer: `---
name: reviewer
permission:
  skill:
    "*": ask
    "pi-*": allow
---
`,
    },
  );

  try {
    // Matches agent frontmatter pi-* pattern
    const allowed = manager.checkPermission("skill", { name: "pi-code-review" }, "reviewer");
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("pi-*");
    expect(allowed.source).toBe("skill");

    // Falls through to agent frontmatter catch-all
    const asked = manager.checkPermission("skill", { name: "other-skill" }, "reviewer");
    expect(asked.state).toBe("ask");
    expect(asked.matchedPattern).toBe("*");

    // No agent override — global deny applies
    const denied = manager.checkPermission("skill", { name: "pi-code-review" });
    expect(denied.state).toBe("deny");
    expect(denied.source).toBe("skill");
  } finally {
    cleanup();
  }
});

test("external_directory pattern map in agent frontmatter overrides global policy", () => {
  const { manager, cleanup } = createManager(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    {
      trusted: `---
name: trusted
permission:
  external_directory:
    "*": deny
    "~/Downloads/*": allow
---
`,
    },
  );

  try {
    // Matches agent frontmatter ~/Downloads/* pattern
    const allowed = manager.checkPermission(
      "external_directory",
      { path: `${homedir()}/Downloads/file.txt` },
      "trusted",
    );
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("~/Downloads/*");
    expect(allowed.source).toBe("special");

    // Falls through to agent frontmatter catch-all deny
    const denied = manager.checkPermission(
      "external_directory",
      { path: `${homedir()}/Documents/secret.txt` },
      "trusted",
    );
    expect(denied.state).toBe("deny");
    expect(denied.matchedPattern).toBe("*");

    // No agent override — global deny applies
    const globalDenied = manager.checkPermission("external_directory", {});
    expect(globalDenied.state).toBe("deny");
    expect(globalDenied.source).toBe("special");
  } finally {
    cleanup();
  }
});

test("project-agent frontmatter skill rules override global-agent frontmatter skill rules", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "deny" },
    },
    {
      analyst: `---
name: analyst
permission:
  skill:
    "*": ask
---
`,
    },
    {
      projectAgentFiles: {
        analyst: `---
name: analyst
permission:
  skill:
    "pi-*": allow
    "*": deny
---
`,
      },
    },
  );

  try {
    // Project-agent pi-* wins over global-agent *: ask
    const allowed = manager.checkPermission("skill", { name: "pi-code-review" }, "analyst");
    expect(allowed.state).toBe("allow");
    expect(allowed.matchedPattern).toBe("pi-*");

    // Project-agent *: deny wins over global-agent *: ask
    const denied = manager.checkPermission("skill", { name: "other-skill" }, "analyst");
    expect(denied.state).toBe("deny");
    expect(denied.matchedPattern).toBe("*");
  } finally {
    cleanup();
  }
});

test("project-agent frontmatter external_directory rules override global-agent frontmatter rules", () => {
  const { manager, cleanup } = createManagerWithProject(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    {
      analyst: `---
name: analyst
permission:
  external_directory: ask
---
`,
    },
    {
      projectAgentFiles: {
        analyst: `---
name: analyst
permission:
  external_directory: allow
---
`,
      },
    },
  );

  try {
    // Project-agent allow wins over global-agent ask
    const result = manager.checkPermission("external_directory", {}, "analyst");
    expect(result.state).toBe("allow");
    expect(result.source).toBe("special");

    // Without agent context, global config deny applies
    const globalResult = manager.checkPermission("external_directory", {});
    expect(globalResult.state).toBe("deny");
  } finally {
    cleanup();
  }
});

test("tool_call blocks path-bearing tools outside cwd when external_directory is denied", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-permission-system-boundary-"));
  const cwd = join(rootDir, "repo");
  const siblingPath = join(rootDir, "repo-sibling", "secret.txt");
  mkdirSync(join(rootDir, "repo-sibling"), { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    ["read"],
    { cwd },
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "read",
      toolCallId: "external-deny",
      input: { path: siblingPath },
    });

    expect(result.block).toBe(true);
    const reason = String(result.reason);
    expect(reason).toContain("is not permitted to run tool 'read'");
    expect(reason).toContain("repo-sibling");
    expect(reason).toContain("[pi-permission-system]");
    expect(reason).not.toContain("Hard stop");
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("tool_call allows path-bearing tools inside cwd without external_directory prompt", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    ["read"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "read",
      toolCallId: "internal-allow",
      input: { path: join(harness.cwd, "src", "index.ts") },
    });

    expect(result).toEqual({});
    expect(harness.prompts).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

test("tool_call blocks external_directory ask when no confirmation channel is available", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["write"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "write",
      toolCallId: "external-ask-no-ui",
      input: {
        path: join(harness.cwd, "..", "outside.txt"),
        content: "blocked",
      },
    });

    expect(result.block).toBe(true);
    expect(String(result.reason)).toMatch(/requires approval, but no interactive UI is available/i);
  } finally {
    await harness.cleanup();
  }
});

test("tool_call prompts for external_directory and then falls through to normal tool policy", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["grep"],
  );

  try {
    const externalPath = join(harness.cwd, "..", "external-search-root");
    const result = await runToolCall(
      harness,
      {
        toolName: "grep",
        toolCallId: "external-ask-approved",
        input: { pattern: "needle", path: externalPath },
      },
      { hasUI: true, selectResponse: "Yes" },
    );

    expect(result).toEqual({});
    expect(harness.prompts.length).toBe(1);
    expect(harness.prompts[0]).toMatch(/external directory access/i);
    expect(harness.prompts[0]).toMatch(/grep/);
    expect(harness.prompts[0]).toMatch(/external-search-root/);
  } finally {
    await harness.cleanup();
  }
});

test("tool_call skips external_directory checks for optional path tools without a path", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    ["find"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "find",
      toolCallId: "find-default-cwd",
      input: { pattern: "*.ts" },
    });

    expect(result).toEqual({});
    expect(harness.prompts).toEqual([]);
  } finally {
    await harness.cleanup();
  }
});

// --- bash external_directory integration tests (#39) ---

test("tool_call blocks bash command with external path when external_directory is denied", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    ["bash"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "bash",
      toolCallId: "bash-external-deny",
      input: { command: "cat /etc/hosts" },
    });

    expect(result.block).toBe(true);
    const reason = String(result.reason);
    expect(reason).toContain("is not permitted to run bash command 'cat /etc/hosts'");
    expect(reason).toContain("/etc/hosts");
    expect(reason).toContain("[pi-permission-system]");
    expect(reason).not.toContain("Hard stop");
  } finally {
    await harness.cleanup();
  }
});

test("tool_call allows bash command with only internal paths when external_directory is denied", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "deny" },
    },
    ["bash"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "bash",
      toolCallId: "bash-internal-allow",
      input: { command: "cat src/index.ts" },
    });

    expect(result).toEqual({});
  } finally {
    await harness.cleanup();
  }
});

test("tool_call prompts for bash command with external path when external_directory is ask", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["bash"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "bash",
      toolCallId: "bash-external-ask-no-ui",
      input: { command: "cat /etc/hosts" },
    });

    // No UI available in default harness, so it should block
    expect(result.block).toBe(true);
    expect(String(result.reason)).toMatch(/requires approval.*no interactive UI/i);
  } finally {
    await harness.cleanup();
  }
});

test("tool_call allows bash command with external path when external_directory is allow", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "allow" },
    },
    ["bash"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "bash",
      toolCallId: "bash-external-allow",
      input: { command: "cat /etc/hosts" },
    });

    // Should pass through to normal bash permission (which is also allow)
    expect(result).toEqual({});
  } finally {
    await harness.cleanup();
  }
});

test("tool_call applies bash pattern permissions after external_directory allow", async () => {
  const harness = createToolCallHarness(
    {
      permission: {
        "*": "allow",
        external_directory: "allow",
        bash: { "*": "allow", "cat *": "deny" },
      },
    },
    ["bash"],
  );

  try {
    const result = await runToolCall(harness, {
      toolName: "bash",
      toolCallId: "bash-pattern-deny-after-ext-allow",
      input: { command: "cat /etc/hosts" },
    });

    // external_directory allows, but bash pattern denies
    expect(result.block).toBe(true);
    expect(String(result.reason)).toMatch(/not permitted/i);
  } finally {
    await harness.cleanup();
  }
});

test("generic ask prompts include serialized tool input for informed approval", async () => {
  const harness = createToolCallHarness(
    {
      permission: { "*": "ask" },
    },
    ["weather_lookup"],
  );

  try {
    const result = await runToolCall(
      harness,
      {
        toolName: "weather_lookup",
        toolCallId: "generic-tool-input",
        input: { city: "Chicago", units: "metric" },
      },
      { hasUI: true, selectResponse: "No" },
    );

    expect(result.block).toBe(true);
    expect(harness.prompts.length).toBe(1);
    expect(harness.prompts[0]).toMatch(/weather_lookup/);
    expect(harness.prompts[0]).toMatch(/\{"city":"Chicago","units":"metric"\}/);
  } finally {
    await harness.cleanup();
  }
});

test("getResolvedPolicyPaths returns correct paths and existence when files exist", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "policy-paths-exist-"));
  try {
    const globalConfigPath = join(tempDir, "pi-permissions.jsonc");
    const agentsDir = join(tempDir, "agents");
    const projectConfigPath = join(tempDir, "project", "pi-permissions.jsonc");
    const projectAgentsDir = join(tempDir, "project", "agents");

    writeFileSync(globalConfigPath, "{}", "utf-8");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(join(tempDir, "project"), { recursive: true });
    writeFileSync(projectConfigPath, "{}", "utf-8");
    mkdirSync(projectAgentsDir, { recursive: true });

    const pm = new PermissionManager({
      globalConfigPath,
      agentsDir,
      projectGlobalConfigPath: projectConfigPath,
      projectAgentsDir,
    });

    const result = pm.getResolvedPolicyPaths();

    expect(result.globalConfigPath).toBe(globalConfigPath);
    expect(result.globalConfigExists).toBe(true);
    expect(result.projectConfigPath).toBe(projectConfigPath);
    expect(result.projectConfigExists).toBe(true);
    expect(result.agentsDir).toBe(agentsDir);
    expect(result.agentsDirExists).toBe(true);
    expect(result.projectAgentsDir).toBe(projectAgentsDir);
    expect(result.projectAgentsDirExists).toBe(true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getResolvedPolicyPaths returns false for missing files and null for absent project paths", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "policy-paths-missing-"));
  try {
    const globalConfigPath = join(tempDir, "does-not-exist.jsonc");
    const agentsDir = join(tempDir, "no-agents");

    const pm = new PermissionManager({
      globalConfigPath,
      agentsDir,
    });

    const result = pm.getResolvedPolicyPaths();

    expect(result.globalConfigPath).toBe(globalConfigPath);
    expect(result.globalConfigExists).toBe(false);
    expect(result.projectConfigPath).toBe(null);
    expect(result.projectConfigExists).toBe(false);
    expect(result.agentsDir).toBe(agentsDir);
    expect(result.agentsDirExists).toBe(false);
    expect(result.projectAgentsDir).toBe(null);
    expect(result.projectAgentsDirExists).toBe(false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// --- config issues tests ---

test("PermissionManager.getConfigIssues returns empty array for clean config", () => {
  const config: ScopeConfig = {
    permission: { "*": "ask", external_directory: "ask" },
  };
  const { manager, cleanup } = createManager(config);
  try {
    const issues = manager.getConfigIssues();
    expect(issues.length).toBe(0);
  } finally {
    cleanup();
  }
});

test("PermissionManager.getConfigIssues returns empty array for empty config", () => {
  const { manager, cleanup } = createManager({});
  try {
    const issues = manager.getConfigIssues();
    expect(issues.length).toBe(0);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Session-scoped approval tests (#45)
// ---------------------------------------------------------------------------

test("session approval: first prompt with 'Yes, for this session' skips subsequent prompts under same prefix", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-session-approval-"));
  const cwd = join(rootDir, "repo");
  const siblingDir = join(rootDir, "sibling-project");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(siblingDir, { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["read", "grep"],
    { cwd },
  );

  try {
    // First access — user selects "Yes, for this session"
    const result1 = await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-session-1",
        input: { path: join(siblingDir, "src", "foo.ts") },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(result1).toEqual({});
    expect(harness.prompts.length).toBe(1);

    // Second access under same prefix — should skip prompt
    const result2 = await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-session-2",
        input: { path: join(siblingDir, "src", "bar.ts") },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(result2).toEqual({});
    // No new prompt — still just the original one
    expect(harness.prompts.length).toBe(1);

    // Third access with different tool under same prefix — also skipped
    const result3 = await runToolCall(
      harness,
      {
        toolName: "grep",
        toolCallId: "ext-session-3",
        input: { pattern: "needle", path: join(siblingDir, "src", "baz.ts") },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(result3).toEqual({});
    expect(harness.prompts.length).toBe(1);
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session approval: different directory prefix still prompts", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-session-approval-"));
  const cwd = join(rootDir, "repo");
  const siblingA = join(rootDir, "sibling-a");
  const siblingB = join(rootDir, "sibling-b");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(siblingA, { recursive: true });
  mkdirSync(siblingB, { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["read"],
    { cwd },
  );

  try {
    // Approve sibling-a/src/ for session
    await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-diff-1",
        input: { path: join(siblingA, "src", "foo.ts") },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(harness.prompts.length).toBe(1);

    // Access sibling-b — different prefix, should prompt again
    await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-diff-2",
        input: { path: join(siblingB, "src", "bar.ts") },
      },
      { hasUI: true, selectResponse: "Yes" },
    );
    expect(harness.prompts.length).toBe(2);
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session approval: session_shutdown clears session approvals", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-session-approval-"));
  const cwd = join(rootDir, "repo");
  const siblingDir = join(rootDir, "sibling");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(siblingDir, { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["read"],
    { cwd },
  );

  try {
    // Approve for session
    await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-shutdown-1",
        input: { path: join(siblingDir, "src", "foo.ts") },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(harness.prompts.length).toBe(1);

    // Trigger session_shutdown (clears cache)
    const shutdownCtx = createMockContext(cwd, harness.prompts, {
      hasUI: true,
      selectResponse: "Yes",
    });
    await Promise.resolve(harness.handlers.session_shutdown({}, shutdownCtx));

    // Access same path again — should prompt because cache was cleared
    const result = await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-shutdown-2",
        input: { path: join(siblingDir, "src", "foo.ts") },
      },
      { hasUI: true, selectResponse: "Yes" },
    );
    expect(result).toEqual({});
    expect(harness.prompts.length).toBe(2);
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session approval: bash external directory with 'Yes, for this session' skips subsequent prompts", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-session-approval-"));
  const cwd = join(rootDir, "repo");
  mkdirSync(cwd, { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["bash"],
    { cwd },
  );

  try {
    const externalPath = join(rootDir, "other-project", "src");
    // First bash command referencing external path
    const result1 = await runToolCall(
      harness,
      {
        toolName: "bash",
        toolCallId: "bash-session-1",
        input: { command: `ls ${externalPath}/foo.ts` },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(result1).toEqual({});
    expect(harness.prompts.length).toBe(1);

    // Second bash command referencing path under same prefix — skips prompt
    const result2 = await runToolCall(
      harness,
      {
        toolName: "bash",
        toolCallId: "bash-session-2",
        input: { command: `cat ${externalPath}/bar.ts` },
      },
      { hasUI: true, selectResponse: "Yes, for this session" },
    );
    expect(result2).toEqual({});
    expect(harness.prompts.length).toBe(1);
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("session approval: regular 'Yes' does not create session approval", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "pi-session-approval-"));
  const cwd = join(rootDir, "repo");
  const siblingDir = join(rootDir, "sibling");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(siblingDir, { recursive: true });

  const harness = createToolCallHarness(
    {
      permission: { "*": "allow", external_directory: "ask" },
    },
    ["read"],
    { cwd },
  );

  try {
    // Approve once with "Yes" (not session)
    await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-once-1",
        input: { path: join(siblingDir, "src", "foo.ts") },
      },
      { hasUI: true, selectResponse: "Yes" },
    );
    expect(harness.prompts.length).toBe(1);

    // Same prefix — should still prompt since we used "Yes" not session
    await runToolCall(
      harness,
      {
        toolName: "read",
        toolCallId: "ext-once-2",
        input: { path: join(siblingDir, "src", "bar.ts") },
      },
      { hasUI: true, selectResponse: "Yes" },
    );
    expect(harness.prompts.length).toBe(2);
  } finally {
    await harness.cleanup();
    rmSync(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Session-aware checkPermission() integration
// ---------------------------------------------------------------------------

test("checkPermission returns source 'session' when session rules cover the external_directory path", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow" },
  });

  try {
    const sessionRules = [
      {
        surface: "external_directory",
        pattern: "/other/project/*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission(
      "external_directory",
      { path: "/other/project/src/foo.ts" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("/other/project/*");
  } finally {
    cleanup();
  }
});

test("checkPermission falls back to config policy when session rules do not cover the path", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "deny" },
  });

  try {
    const sessionRules = [
      {
        surface: "external_directory",
        pattern: "/other/project/*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    // Path NOT under /other/project/ — session rules don't match.
    const result = manager.checkPermission(
      "external_directory",
      { path: "/completely/different/path.ts" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("deny");
    expect(result.source).toBe("special");
  } finally {
    cleanup();
  }
});

test("checkPermission with empty session rules is identical to call without sessionRules arg", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "deny" },
  });

  try {
    const withEmpty = manager.checkPermission(
      "external_directory",
      { path: "/other/project/foo.ts" },
      undefined,
      [],
    );
    const withoutArg = manager.checkPermission("external_directory", {
      path: "/other/project/foo.ts",
    });
    const expected: PermissionCheckResult = {
      toolName: "external_directory",
      state: "deny",
      matchedPattern: "*",
      source: "special",
      origin: "global",
    };
    expect(withEmpty).toEqual(expected);
    expect(withoutArg).toEqual(expected);
  } finally {
    cleanup();
  }
});

test("session rules for one surface do not affect checks on other surfaces", () => {
  const { manager, cleanup } = createManager({
    // Empty permission: universal default is "ask" from DEFAULT_UNIVERSAL_FALLBACK.
    permission: {},
  });

  try {
    const sessionRules = [
      {
        surface: "external_directory",
        pattern: "/other/project/*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    // Bash check — session rules should not affect bash decisions.
    const bashResult = manager.checkPermission(
      "bash",
      { command: "git status" },
      undefined,
      sessionRules,
    );
    expect(bashResult.state).toBe("ask");
    expect(bashResult.source).toBe("bash");

    // MCP check — session rules should not affect MCP decisions.
    const mcpResult = manager.checkPermission(
      "mcp",
      { tool: "exa:search" },
      undefined,
      sessionRules,
    );
    expect(mcpResult.state).toBe("ask");
    expect(mcpResult.source).toBe("default");
  } finally {
    cleanup();
  }
});

test("session rules override config deny for external_directory", () => {
  const { manager, cleanup } = createManager({
    permission: { "*": "allow", external_directory: "deny" },
  });

  try {
    const sessionRules = [
      {
        surface: "external_directory",
        pattern: "/other/project/*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    // Session approval overrides config deny for the covered path.
    const result = manager.checkPermission(
      "external_directory",
      { path: "/other/project/src/foo.ts" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  } finally {
    cleanup();
  }
});

// ── Session rule evaluation for all surfaces ─────────────────────────────

test("checkPermission returns source 'session' for bash when session rules match", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission(
      "bash",
      { command: "git status --short" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("git *");
  } finally {
    cleanup();
  }
});

test("checkPermission returns source 'session' for bash when session rule is exact match", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "ls",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission("bash", { command: "ls" }, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  } finally {
    cleanup();
  }
});

test("checkPermission falls back to config for bash when session rules do not match the command", () => {
  const { manager, cleanup } = createManager({ permission: { bash: "deny" } });

  try {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission(
      "bash",
      { command: "npm run build" },
      undefined,
      sessionRules,
    );
    expect(result.state).toBe("deny");
    expect(result.source).toBe("bash");
  } finally {
    cleanup();
  }
});

test("checkPermission returns source 'session' for mcp when session rules match the target", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "mcp",
        pattern: "exa:*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission("mcp", { tool: "exa:search" }, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  } finally {
    cleanup();
  }
});

test("checkPermission returns source 'session' for skill when session rules match", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "skill",
        pattern: "librarian",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission("skill", { name: "librarian" }, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
    expect(result.matchedPattern).toBe("librarian");
  } finally {
    cleanup();
  }
});

test("checkPermission returns source 'session' for tool surface when session rules match", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "read",
        pattern: "*",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission("read", {}, undefined, sessionRules);
    expect(result.state).toBe("allow");
    expect(result.source).toBe("session");
  } finally {
    cleanup();
  }
});

test("bash session rules do not bleed into mcp checks", () => {
  const { manager, cleanup } = createManager({ permission: {} });

  try {
    const sessionRules = [
      {
        surface: "bash",
        pattern: "git *",
        action: "allow" as const,
        layer: "session" as const,
        origin: "session" as const,
      },
    ];

    const result = manager.checkPermission("mcp", { tool: "exa:search" }, undefined, sessionRules);
    // bash session rule must not affect mcp surface
    expect(result.source).not.toBe("session");
  } finally {
    cleanup();
  }
});

// Suppress unused import warning — PermissionState used in type annotations
const _unused: PermissionState = "ask";
void _unused;

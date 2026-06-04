import { isPermissionState } from "./common";
import { normalizeInput } from "./input-normalizer";
import { normalizeFlatConfig } from "./normalize";
import { mergeFlatPermissions } from "./permission-merge";
import {
  FilePolicyLoader,
  type PolicyLoader,
  type PolicyLoaderOptions,
  type ResolvedPolicyPaths,
} from "./policy-loader";
import type { Rule, RuleOrigin, Ruleset } from "./rule";
import { evaluate, evaluateFirst } from "./rule";
import { composeRuleset, synthesizeBaseline, synthesizeDefaults } from "./synthesize";
import type { FlatPermissionConfig, PermissionCheckResult, PermissionState } from "./types";

const BUILT_IN_TOOL_PERMISSION_NAMES = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
]);
const SPECIAL_PERMISSION_KEYS = new Set(["external_directory", "path"]);

/** Universal fallback when permission["*"] is absent from all scopes. */
const DEFAULT_UNIVERSAL_FALLBACK: PermissionState = "ask";

type FileCacheEntry<TValue> = {
  stamp: string;
  value: TValue;
};

type ResolvedPermissions = {
  /**
   * Fully composed ruleset: synthesized defaults → baseline → config.
   * Session rules are appended at call-time inside checkPermission().
   */
  composedRules: Ruleset;
};

export interface PermissionManagerOptions extends PolicyLoaderOptions {
  policyLoader?: PolicyLoader;
}

export class PermissionManager {
  private readonly loader: PolicyLoader;
  private readonly resolvedPermissionsCache = new Map<
    string,
    FileCacheEntry<ResolvedPermissions>
  >();

  constructor(options: PermissionManagerOptions = {}) {
    this.loader = options.policyLoader ?? new FilePolicyLoader(options);
  }

  getConfigIssues(agentName?: string): string[] {
    // Trigger a load/resolve to ensure issues are collected.
    this.resolvePermissions(agentName);
    return [...this.loader.getConfigIssues()];
  }

  getResolvedPolicyPaths(): ResolvedPolicyPaths {
    return this.loader.getResolvedPolicyPaths();
  }

  getPolicyCacheStamp(agentName?: string): string {
    return this.loader.getCacheStamp(agentName);
  }

  private resolvePermissions(agentName?: string): ResolvedPermissions {
    const cacheKey = agentName ?? "__global__";
    const stamp = this.loader.getCacheStamp(agentName);
    const cached = this.resolvedPermissionsCache.get(cacheKey);
    if (cached?.stamp === stamp) {
      return cached.value;
    }

    const globalConfig = this.loader.loadGlobalConfig();
    const projectConfig = this.loader.loadProjectConfig();
    const agentConfig = this.loader.loadAgentConfig(agentName);
    const projectAgentConfig = this.loader.loadProjectAgentConfig(agentName);

    // Merge permission objects across scopes (lowest → highest precedence).
    // Build a parallel origin map that tracks which scope contributed each
    // (surface, pattern) entry, mirroring mergeFlatPermissions() semantics.
    type OriginMap = Map<string, Map<string, RuleOrigin>>;
    const origins: OriginMap = new Map();
    let mergedPermission: FlatPermissionConfig = {};

    for (const [scopeName, scope] of [
      ["global", globalConfig],
      ["project", projectConfig],
      ["agent", agentConfig],
      ["project-agent", projectAgentConfig],
    ] as const) {
      if (!scope.permission) continue;

      for (const [surface, value] of Object.entries(scope.permission)) {
        const baseVal = mergedPermission[surface];
        /* eslint-disable @typescript-eslint/no-unnecessary-condition -- defensive null/type checks; config values may differ at runtime */
        const bothObjects =
          typeof baseVal === "object" &&
          baseVal !== null &&
          typeof value === "object" &&
          value !== null;
        /* eslint-enable @typescript-eslint/no-unnecessary-condition */

        if (bothObjects) {
          // Shallow-merge: each incoming pattern is attributed to this scope;
          // existing patterns from lower scopes keep their earlier origin.
          if (!origins.has(surface)) origins.set(surface, new Map());
          for (const pattern of Object.keys(value)) {
            origins.get(surface)?.set(pattern, scopeName);
          }
        } else {
          // Full replacement: this scope takes over the entire surface entry.
          const surfaceOrigins = new Map<string, RuleOrigin>();
          if (typeof value === "string") {
            surfaceOrigins.set("*", scopeName);
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive null check
          } else if (typeof value === "object" && value !== null) {
            for (const pattern of Object.keys(value)) {
              surfaceOrigins.set(pattern, scopeName);
            }
          }
          origins.set(surface, surfaceOrigins);
        }
      }

      mergedPermission = mergeFlatPermissions(mergedPermission, scope.permission);
    }

    // Extract the universal fallback from permission["*"].
    // The "*" key feeds synthesizeDefaults() only — it is NOT included as a
    // config rule so that extension tools fall through to source:"default".
    const universalFallback = isPermissionState(mergedPermission["*"])
      ? mergedPermission["*"]
      : DEFAULT_UNIVERSAL_FALLBACK;
    // Track which scope contributed the universal fallback.
    const universalFallbackOrigin: RuleOrigin = origins.get("*")?.get("*") ?? "builtin";

    // Build config rules from everything except the universal "*" key.
    const permissionWithoutUniversal: FlatPermissionConfig = Object.fromEntries(
      Object.entries(mergedPermission).filter(([k]) => k !== "*"),
    );

    // Normalize to config rules, tagged with "config" layer and their origin.
    const configRules: Ruleset = normalizeFlatConfig(permissionWithoutUniversal).map(
      (r): Rule => ({
        ...r,
        layer: "config",
        origin: origins.get(r.surface)?.get(r.pattern) ?? "builtin",
      }),
    );

    const composedRules = composeRuleset(
      synthesizeDefaults(universalFallback, universalFallbackOrigin),
      synthesizeBaseline(configRules),
      configRules,
    );

    const value: ResolvedPermissions = { composedRules };
    this.resolvedPermissionsCache.set(cacheKey, { stamp, value });
    return value;
  }

  /**
   * Return the composed config-layer rules for the given agent scope.
   * Used by the `/permission-system show` command to display effective rules
   * with their origin annotations.
   * Session rules are not included — they are runtime-only.
   */
  getComposedConfigRules(agentName?: string): Ruleset {
    const { composedRules } = this.resolvePermissions(agentName);
    return composedRules.filter((r) => r.layer === "config");
  }

  /**
   * Get the tool-level permission state for a tool, without considering
   * command-level rules. Used for tool injection decisions.
   */
  getToolPermission(toolName: string, agentName?: string): PermissionState {
    const { composedRules } = this.resolvePermissions(agentName);
    const normalizedToolName = toolName.trim();

    // Special surfaces (external_directory): evaluate directly by surface name.
    if (SPECIAL_PERMISSION_KEYS.has(normalizedToolName)) {
      return evaluate(normalizedToolName, "*", composedRules).action;
    }

    // Bash, MCP, skill: evaluate with "*" value — the per-surface catch-all
    // (or universal default) handles this correctly.
    if (normalizedToolName === "bash") {
      return evaluate("bash", "*", composedRules).action;
    }
    if (normalizedToolName === "mcp") {
      return evaluate("mcp", "*", composedRules).action;
    }
    if (normalizedToolName === "skill") {
      return evaluate("skill", "*", composedRules).action;
    }

    // Tool-name surfaces (read, write, etc. and extension tools).
    return evaluate(normalizedToolName, "*", composedRules).action;
  }

  checkPermission(
    toolName: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult {
    const { composedRules } = this.resolvePermissions(agentName);
    const normalizedToolName = toolName.trim();

    // Append session rules at the end (highest priority) so evaluate() handles
    // them via last-match-wins — no separate per-branch pre-check needed.
    const fullRules: Ruleset = sessionRules?.length
      ? [...composedRules, ...sessionRules]
      : composedRules;

    const { surface, values, resultExtras } = normalizeInput(
      normalizedToolName,
      input,
      this.loader.getConfiguredMcpServerNames(),
    );

    const { rule, value } = evaluateFirst(surface, values, fullRules);

    // For MCP, replace the normalizer's fallback target with the actual
    // matched candidate value so PermissionCheckResult.target is accurate.
    const extras = surface === "mcp" ? { ...resultExtras, target: value } : resultExtras;

    return {
      toolName,
      state: rule.action,
      matchedPattern:
        rule.layer === "config" || rule.layer === "session" ? rule.pattern : undefined,
      source: deriveSource(rule, normalizedToolName),
      origin: rule.origin,
      ...extras,
    };
  }
}

/**
 * Map a matched rule + tool name to the correct PermissionCheckResult.source.
 *
 * Mirrors the source-derivation logic from the former per-branch
 * checkPermission() implementation:
 *
 * - session          → "session" (always, all surfaces)
 * - mcp + default    → "default"
 * - mcp + other      → "mcp"
 * - special          → "special" (always)
 * - skill            → "skill" (always)
 * - bash             → "bash" (always)
 * - built-in tool    → "tool" (always)
 * - extension tool   → "default" when default layer, "tool" otherwise
 */
function deriveSource(rule: Rule, toolName: string): PermissionCheckResult["source"] {
  if (rule.layer === "session") return "session";

  if (toolName === "mcp") {
    if (rule.layer === "default") return "default";
    return "mcp";
  }

  if (SPECIAL_PERMISSION_KEYS.has(toolName)) return "special";
  if (toolName === "skill") return "skill";
  if (toolName === "bash") return "bash";

  // Built-in tools always report "tool"; extension tools distinguish default.
  if (BUILT_IN_TOOL_PERMISSION_NAMES.has(toolName)) return "tool";
  return rule.layer === "default" ? "default" : "tool";
}

// Re-export types that external modules import from this file.
export type { PolicyLoader, ResolvedPolicyPaths } from "./policy-loader";

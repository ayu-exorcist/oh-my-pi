export type PermissionState = "allow" | "deny" | "ask";

import type { RuleOrigin } from "./rule";

export type { RuleOrigin };

/**
 * The on-disk permission shape inside the `"permission"` key.
 * Each key is a surface name; values are either a PermissionState string
 * (shorthand for `{ "*": action }`) or a pattern→action map.
 */
export type FlatPermissionConfig = Record<
  string,
  PermissionState | Record<string, PermissionState>
>;

/**
 * Per-scope permission config shape after loading and validation.
 * Holds only the flat permission map — all policy is expressed there.
 */
export interface ScopeConfig {
  permission?: FlatPermissionConfig;
}

export interface PermissionCheckResult {
  toolName: string;
  state: PermissionState;
  matchedPattern?: string;
  command?: string;
  target?: string;
  source: "tool" | "bash" | "mcp" | "skill" | "special" | "default" | "session";
  /** Which source contributed the winning rule. */
  origin: RuleOrigin;
}

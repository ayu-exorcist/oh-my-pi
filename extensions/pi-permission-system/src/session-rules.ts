import { posix } from "node:path";

import type { Ruleset } from "./rule";

/**
 * Ephemeral in-memory store of session-scoped permission approvals.
 *
 * Each approval is stored as a `Rule` with `action: "allow"`, making the
 * ruleset directly usable with `evaluate()` — no custom matching engine needed.
 *
 * Cleared on session_shutdown — never persisted to disk.
 */
export class SessionRules {
  private rules: Ruleset = [];

  /** Record a wildcard pattern as approved for the given surface. */
  approve(surface: string, pattern: string): void {
    this.rules.push({
      surface,
      pattern,
      action: "allow",
      layer: "session",
      origin: "session",
    });
  }

  /** Return a defensive copy of the current session ruleset. */
  getRuleset(): Ruleset {
    return [...this.rules];
  }

  /** Remove all session approvals. */
  clear(): void {
    this.rules = [];
  }
}

/**
 * Derive the wildcard glob pattern to approve from a normalized path.
 *
 * Returns `<parent-dir>/*` so that `evaluate()` / `wildcardMatch()` matches
 * all paths under the approved directory — identical semantics to the former
 * `SessionApprovalCache` prefix matching, using the unified wildcard engine.
 *
 * For paths that already end with a separator (directories), the separator
 * is treated as the directory boundary and `*` is appended directly.
 */
export function deriveApprovalPattern(normalizedPath: string): string {
  const comparablePath = normalizedPath.replace(/\\/g, "/");

  // If the path already ends with a separator, it's a directory — glob its contents.
  if (comparablePath.endsWith("/")) {
    return `${comparablePath}*`;
  }
  const dir = posix.dirname(comparablePath);
  if (dir === comparablePath) {
    // Root path — dirname('/') === '/'
    return `${dir}*`;
  }
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return `${prefix}*`;
}

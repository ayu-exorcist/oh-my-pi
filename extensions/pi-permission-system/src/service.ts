/**
 * Cross-extension service accessor backed by `Symbol.for()` on `globalThis`.
 *
 * `Symbol.for()` is process-global by spec, so it survives jiti's per-extension
 * module isolation (`moduleCache: false`). A consumer doing
 * `import("@ayulab/pi-permission-system")` gets a fresh module copy, but
 * `getPermissionsService()` reads from the same `globalThis` slot the provider
 * wrote to — enabling direct, synchronous, type-safe function calls.
 *
 * Best practice: call `getPermissionsService()` per use rather than caching the
 * reference — this ensures resilience across `/reload` and load-order edge cases.
 */

import type { SubagentSessionInfo } from "./subagent-registry";
import type { PermissionCheckResult, PermissionState } from "./types";

export type { PermissionCheckResult, PermissionState, SubagentSessionInfo };

/** Process-global key for the service slot. */
const SERVICE_KEY = Symbol.for("@ayulab/pi-permission-system:service");

/**
 * Public interface exposed to other extensions via `getPermissionsService()`.
 *
 * Mirrors the simplified RPC signature — surface + optional value + optional
 * agent name — and delegates to `PermissionManager.checkPermission()` with
 * current session rules internally.
 */
export interface PermissionsService {
  /**
   * Query the permission policy for a surface and value.
   *
   * @param surface   - Permission surface: "bash", "read", "mcp", "skill",
   *                    "external_directory", etc.
   * @param value     - The value to evaluate: command string, tool name, skill
   *                    name, or path. Omit or pass `undefined` for a
   *                    surface-level query.
   * @param agentName - Optional agent name for per-agent policy resolution.
   * @returns Full check result including state, matched pattern, and origin.
   */
  checkPermission(surface: string, value?: string, agentName?: string): PermissionCheckResult;

  /**
   * Register an in-process subagent session.
   *
   * Call this before `bindExtensions()` so that `isSubagentExecutionContext()`
   * and permission-forwarding target resolution can detect the child session.
   * Always pair with `unregisterSubagentSession()` in a `finally` block.
   *
   * @param sessionKey - Unique session identifier (use the session directory path).
   * @param info       - Agent name and optional parent session ID.
   */
  registerSubagentSession(sessionKey: string, info: SubagentSessionInfo): void;

  /**
   * Remove a previously registered in-process subagent session.
   *
   * Safe to call even if `registerSubagentSession` was never called for this key.
   *
   * @param sessionKey - The same key passed to `registerSubagentSession`.
   */
  unregisterSubagentSession(sessionKey: string): void;

  /**
   * Query the tool-level permission state for pre-filtering tools before
   * creating a child session.
   *
   * Returns `"deny"` | `"allow"` | `"ask"` based on the composed policy.
   * Does not consider command-level rules (e.g. per-bash-command patterns) —
   * use `checkPermission` for runtime invocation gates.
   *
   * @param toolName  - Tool name (e.g. `"bash"`, `"read"`, `"my-extension:tool"`).
   * @param agentName - Optional agent name for per-agent policy resolution.
   */
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}

/**
 * Store a `PermissionsService` on `globalThis` so other extensions can
 * retrieve it via `getPermissionsService()`.
 *
 * Overwrites any previously published service — safe for `/reload`.
 */
export function publishPermissionsService(service: PermissionsService): void {
  (globalThis as Record<symbol, unknown>)[SERVICE_KEY] = service;
}

/**
 * Retrieve the published `PermissionsService`, or `undefined` if the
 * permission-system extension has not loaded (or has been unloaded).
 */
export function getPermissionsService(): PermissionsService | undefined {
  return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as PermissionsService | undefined;
}

/**
 * Remove the service from `globalThis`.
 *
 * Called during `session_shutdown` to avoid stale references after the
 * extension is torn down.
 */
export function unpublishPermissionsService(): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property; Map.delete() is not applicable
  delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}

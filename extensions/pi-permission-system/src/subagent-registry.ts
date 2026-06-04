/**
 * subagent-registry.ts — In-process subagent session registry.
 *
 * In-process subagent extensions (e.g. `@gotgenes/pi-subagents`) register
 * each child session here before calling `bindExtensions()` so that
 * `isSubagentExecutionContext()` and permission-forwarding target resolution
 * can detect them without relying on environment variables or filesystem
 * heuristics.
 *
 * The registry is keyed by session directory path, which is unique per
 * session and available to both producer and consumer via
 * `ctx.sessionManager.getSessionDir()`.
 */

/** Signal stored per registered in-process subagent session. */
export interface SubagentSessionInfo {
  /** Parent session ID for permission forwarding. Omit when unknown. */
  parentSessionId?: string;
  /** Agent name for per-agent policy resolution. */
  agentName: string;
}

/**
 * Registry of active in-process subagent sessions.
 *
 * Owned by `ExtensionRuntime`; exposed to external callers through the
 * `PermissionsService` interface (`registerSubagentSession` /
 * `unregisterSubagentSession`).
 *
 * Concurrent background agents are safe because each session has a unique
 * directory path as its key — no scalar global flag is needed.
 */
export class SubagentSessionRegistry {
  private readonly sessions = new Map<string, SubagentSessionInfo>();

  /**
   * Register an in-process subagent session.
   *
   * If a previous entry exists for `sessionKey`, it is overwritten
   * (last-write-wins; single-writer expected per key).
   */
  register(sessionKey: string, info: SubagentSessionInfo): void {
    this.sessions.set(sessionKey, info);
  }

  /** Remove a previously registered session. No-op if the key is absent. */
  unregister(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  /** Return the registered info for `sessionKey`, or `undefined` if absent. */
  get(sessionKey: string): SubagentSessionInfo | undefined {
    return this.sessions.get(sessionKey);
  }

  /** Return `true` when `sessionKey` has a registered entry. */
  has(sessionKey: string): boolean {
    return this.sessions.has(sessionKey);
  }
}

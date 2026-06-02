/**
 * Per-session state container used by Pi extensions.
 *
 * Wraps a `Map<string, T>` with lazy-init (`get` + factory) and convenience
 * methods that mirror the patterns repeated across checkpoint-aware extensions.
 */
export class SessionStateMap<T> {
  private map = new Map<string, T>();

  /** Return existing state or create via `factory`, cache, and return. */
  get(sessionId: string, factory: () => T): T {
    let state = this.map.get(sessionId);
    if (!state) {
      state = factory();
      this.map.set(sessionId, state);
    }
    return state;
  }

  /** Return state if it exists, otherwise `undefined`. */
  getOrUndefined(sessionId: string): T | undefined {
    return this.map.get(sessionId);
  }

  /** Explicitly set state for a session (overwrites if present). */
  set(sessionId: string, state: T): void {
    this.map.set(sessionId, state);
  }

  /** Remove state for a session. Returns `true` if it existed. */
  delete(sessionId: string): boolean {
    return this.map.delete(sessionId);
  }

  /** Check whether state exists for a session. */
  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }

  /** Remove all sessions. */
  clear(): void {
    this.map.clear();
  }

  /** Number of tracked sessions. */
  get size(): number {
    return this.map.size;
  }
}

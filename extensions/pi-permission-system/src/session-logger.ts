import type { ExtensionRuntime } from "./runtime";

/**
 * Unified logging + notification surface for handler deps.
 *
 * Replaces three separate logging fields (`writeDebugLog`,
 * `writeReviewLog`, `notifyWarning`) with a single typed collaborator.
 * This is an intermediate abstraction on the path to PermissionSession (#129).
 */
export interface SessionLogger {
  debug(event: string, details?: Record<string, unknown>): void;
  review(event: string, details?: Record<string, unknown>): void;
  warn(message: string): void;
}

/**
 * Create a SessionLogger backed by an ExtensionRuntime.
 *
 * Captures `runtime` by reference so `warn` always reads the current
 * `runtimeContext` at call time — matching the behavior of the inline
 * closures it replaces in `src/index.ts`.
 */
export function createSessionLogger(runtime: ExtensionRuntime): SessionLogger {
  return {
    debug: (event, details) => runtime.writeDebugLog(event, details),
    review: (event, details) => runtime.writeReviewLog(event, details),
    warn: (message) => runtime.runtimeContext?.ui.notify(message, "warning"),
  };
}

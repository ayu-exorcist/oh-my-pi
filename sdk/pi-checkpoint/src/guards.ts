/**
 * Shared type guards used across the checkpoint package.
 *
 * Prefer these over manual `typeof` checks to get narrow types
 * and avoid repeating the same predicates.
 */

/** Narrow `unknown` to `Record<string, unknown>`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to `string`. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Narrow `unknown` to `number` (excludes NaN). */
export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

/** Narrow `unknown` to `boolean`. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Narrow `unknown` to `string[]`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Higher-order guard: build a guard that checks every element of an array.
 *
 * @example
 * const isNumberArray = isArrayOf(isNumber);
 */
export function isArrayOf<T>(
  guard: (item: unknown) => item is T,
): (value: unknown) => value is T[] {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

/**
 * Extract a human-readable message from an unknown error value.
 *
 * Prefer this over manual `instanceof Error` checks to keep error
 * handling uniform across the codebase.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

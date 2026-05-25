/** Narrow `unknown` to `string[]`. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Narrow `unknown` to a plain object (not array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow `unknown` to a valid parsed `package.json` shape. */
import type { PkgJson } from "./types";
export function isPkgJson(value: unknown): value is PkgJson {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.version === "string";
}

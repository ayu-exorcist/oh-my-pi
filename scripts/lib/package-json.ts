import { isRecord } from "@ayulab/runtime-core";
import type { PkgJson } from "./types";

/** Narrow `unknown` to a valid parsed `package.json` shape. */
export function isPkgJson(value: unknown): value is PkgJson {
  if (!isRecord(value)) return false;
  return typeof value.name === "string" && typeof value.version === "string";
}

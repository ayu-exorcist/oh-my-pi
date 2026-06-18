import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getBooleanField,
  getRecordField,
  getStringField,
  isRecord,
  isString,
  isStringArray,
} from "@ayulab/runtime-core";
import type { CheckpointConfig } from "./types";

/**
 * Valid values for restore-behavior settings.
 *
 * Using `as const` produces a true literal union so the compiler
 * knows every possible value at the type level (skill: const assertions).
 */
const RESTORE_OPTIONS = ["always", "ask", "never"] as const;
const TREE_RESTORE_OPTIONS = RESTORE_OPTIONS;
type RestoreOption = (typeof RESTORE_OPTIONS)[number];
type TreeRestoreOption = (typeof TREE_RESTORE_OPTIONS)[number];

function isRestoreOption(value: unknown): value is RestoreOption {
  return isString(value) && RESTORE_OPTIONS.some((v) => v === value);
}

function isTreeRestoreOption(value: unknown): value is TreeRestoreOption {
  return isString(value) && TREE_RESTORE_OPTIONS.some((v) => v === value);
}

export const defaultConfig: CheckpointConfig = {
  enabled: true,
  autoCheckpoint: true,
  restoreOnFork: "always",
  restoreOnClone: "always",
  restoreOnResume: "always",
  restoreOnTree: "never",
  defaultSummaryInstructions: "",
  exclude: [
    "node_modules/**",
    "**/node_modules/**",
    ".git",
    ".pi/**",
    "dist/**",
    "build/**",
    "target/**",
    "*.log",
    "*.tmp",
  ],
};

/**
 * Merge user-provided settings with hard-coded defaults.
 *
 * Every field is validated at runtime via type guards so the
 * returned object is guaranteed to conform to {@link CheckpointConfig}.
 */
export function loadConfig(settings: Record<string, unknown>): CheckpointConfig {
  const ayu = getRecordField(settings, "ayu") ?? {};
  const checkpoint = getRecordField(ayu, "checkpoint") ?? {};
  const rewind = getRecordField(ayu, "rewind") ?? {};
  return {
    enabled: getBooleanField(checkpoint, "enabled") ?? defaultConfig.enabled,
    autoCheckpoint: getBooleanField(checkpoint, "autoCheckpoint") ?? defaultConfig.autoCheckpoint,
    restoreOnFork: isRestoreOption(checkpoint.restoreOnFork)
      ? checkpoint.restoreOnFork
      : defaultConfig.restoreOnFork,
    restoreOnClone: isRestoreOption(checkpoint.restoreOnClone)
      ? checkpoint.restoreOnClone
      : defaultConfig.restoreOnClone,
    restoreOnResume: isRestoreOption(checkpoint.restoreOnResume)
      ? checkpoint.restoreOnResume
      : defaultConfig.restoreOnResume,
    restoreOnTree: isTreeRestoreOption(rewind.restoreOnTree)
      ? rewind.restoreOnTree
      : defaultConfig.restoreOnTree,
    defaultSummaryInstructions:
      getStringField(checkpoint, "defaultSummaryInstructions") ??
      defaultConfig.defaultSummaryInstructions,
    exclude: isStringArray(checkpoint.exclude) ? checkpoint.exclude : defaultConfig.exclude,
  };
}

/**
 * Load configuration from `<configDir>/settings.json`.
 *
 * Returns defaults when the file is missing; re-throws any other
 * error (e.g. permission denied) so the caller can decide what to do.
 */
export function loadConfigFromFile(configDir: string): CheckpointConfig {
  try {
    const raw = readFileSync(join(configDir, "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    return loadConfig(isRecord(parsed) ? parsed : {});
  } catch (err) {
    if (err instanceof SyntaxError) {
      return loadConfig({});
    }
    if (isRecord(err) && err.code === "ENOENT") {
      return loadConfig({});
    }
    throw err;
  }
}

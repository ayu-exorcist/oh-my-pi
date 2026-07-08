import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getBooleanField,
  getNumberField,
  getRecordField,
  getStringField,
  isRecord,
  isStringArray,
} from "@ayulab/runtime-core";
import type { CheckpointConfig } from "./types";

const DEFAULT_EXCLUDE_PATTERNS = [
  ".git",
  "node_modules/",
  "dist/",
  "build/",
  "target/",
  ".gradle/",
  ".ark/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".angular/",
  ".vite/",
  ".parcel-cache/",
  ".turbo/",
  "coverage/",
  ".cache/",
  ".venv/",
  "venv/",
  ".tox/",
  "__pycache__/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "htmlcov/",
  "*.pyc",
  "Pods/",
  ".expo/",
  ".cxx/",
  ".externalNativeBuild/",
  ".build/",
  "DerivedData/",
  ".terraform/",
  ".serverless/",
  ".aws-sam/",
  "**/.idea/workspace.xml",
  "**/.idea/tasks.xml",
  "**/.idea/caches/",
  "**/.idea/shelf/",
  "**/.idea/localHistory/",
  "**/.idea/compile-server/",
  "*.iws",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/Desktop.ini",
  ".vscode-test/",
  "*.swp",
  "*.swo",
  "*.log",
  "*.tmp",
] as const;

function normalizeIncludePatterns(patterns: readonly string[]): readonly string[] {
  return patterns.map((pattern) => (pattern.startsWith("!") ? pattern : `!${pattern}`));
}

function resolveExcludePatterns(
  userExclude: readonly string[],
  userInclude: readonly string[],
): readonly string[] {
  return [...DEFAULT_EXCLUDE_PATTERNS, ...userExclude, ...normalizeIncludePatterns(userInclude)];
}

function resolveMaxFileMB(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export const defaultConfig: CheckpointConfig = {
  enabled: true,
  autoCheckpoint: true,
  restoreOnFork: false,
  restoreOnClone: false,
  restoreOnResume: false,
  restoreOnTree: false,
  defaultSummaryInstructions: "",
  exclude: [...DEFAULT_EXCLUDE_PATTERNS],
  include: [],
  maxFileMB: undefined,
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
  const userExclude = isStringArray(checkpoint.exclude) ? checkpoint.exclude : [];
  const userInclude = isStringArray(checkpoint.include) ? checkpoint.include : [];

  return {
    enabled: getBooleanField(checkpoint, "enabled") ?? defaultConfig.enabled,
    autoCheckpoint: getBooleanField(checkpoint, "autoCheckpoint") ?? defaultConfig.autoCheckpoint,
    restoreOnFork: getBooleanField(checkpoint, "restoreOnFork") ?? defaultConfig.restoreOnFork,
    restoreOnClone: getBooleanField(checkpoint, "restoreOnClone") ?? defaultConfig.restoreOnClone,
    restoreOnResume:
      getBooleanField(checkpoint, "restoreOnResume") ?? defaultConfig.restoreOnResume,
    restoreOnTree: getBooleanField(checkpoint, "restoreOnTree") ?? defaultConfig.restoreOnTree,
    defaultSummaryInstructions:
      getStringField(checkpoint, "defaultSummaryInstructions") ??
      defaultConfig.defaultSummaryInstructions,
    exclude: resolveExcludePatterns(userExclude, userInclude),
    include: userInclude,
    maxFileMB: resolveMaxFileMB(getNumberField(checkpoint, "maxFileMB")),
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

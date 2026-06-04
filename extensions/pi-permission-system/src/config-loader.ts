import { existsSync, readFileSync } from "node:fs";
import { normalize } from "node:path";

import { isPermissionState, toRecord } from "./common";
import {
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectConfigPath,
  getLegacyProjectPolicyPath,
  getProjectConfigPath,
} from "./config-paths";
import { mergeFlatPermissions } from "./permission-merge";
import type { FlatPermissionConfig } from "./types";

/**
 * Unified config shape combining runtime knobs and flat permission policy.
 * All fields are optional so partial configs (project-only, global-only) work.
 */
export interface UnifiedPermissionConfig {
  // Runtime knobs
  debugLog?: boolean;
  permissionReviewLog?: boolean;
  yoloMode?: boolean;

  // Flat permission policy
  permission?: FlatPermissionConfig;
}

export interface UnifiedConfigLoadResult {
  config: UnifiedPermissionConfig;
  issues: string[];
}

export function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let stringQuote: '"' | "'" | "" = "";
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1] || "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inString && char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (!inString && char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    output += char;

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringQuote = char;
      escaping = false;
      continue;
    }

    if (!inString) {
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === stringQuote) {
      inString = false;
      stringQuote = "";
    }
  }

  return output;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Normalize a raw `permission` value from parsed JSON into a FlatPermissionConfig.
 * Drops non-object top-level values, invalid PermissionState strings, and
 * invalid action values inside object maps.
 */
function normalizeFlatPermissionValue(value: unknown): FlatPermissionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized: FlatPermissionConfig = {};
  let hasAny = false;

  for (const [key, val] of Object.entries(record)) {
    if (typeof val === "string") {
      if (isPermissionState(val)) {
        normalized[key] = val;
        hasAny = true;
      }
    } else if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const map: Record<string, import("./types").PermissionState> = {};
      let mapHasAny = false;
      for (const [pattern, action] of Object.entries(val as Record<string, unknown>)) {
        if (isPermissionState(action)) {
          map[pattern] = action;
          mapHasAny = true;
        }
      }
      if (mapHasAny) {
        normalized[key] = map;
        hasAny = true;
      }
    }
  }

  return hasAny ? normalized : undefined;
}

/**
 * Normalize raw parsed JSON into the unified config shape.
 */
export function normalizeUnifiedConfig(raw: unknown): {
  config: UnifiedPermissionConfig;
  issues: string[];
} {
  const record = toRecord(raw);
  const issues: string[] = [];
  const config: UnifiedPermissionConfig = {};

  // Runtime knobs
  const debugLog = normalizeOptionalBoolean(record.debugLog);
  if (debugLog !== undefined) config.debugLog = debugLog;

  const permissionReviewLog = normalizeOptionalBoolean(record.permissionReviewLog);
  if (permissionReviewLog !== undefined) config.permissionReviewLog = permissionReviewLog;

  const yoloMode = normalizeOptionalBoolean(record.yoloMode);
  if (yoloMode !== undefined) config.yoloMode = yoloMode;

  // Flat permission policy
  const permission = normalizeFlatPermissionValue(record.permission);
  if (permission !== undefined) config.permission = permission;

  return { config, issues };
}

/**
 * Merge two unified configs.
 * - `permission` is deep-shallow merged (surface-level object maps are shallow-merged).
 * - Scalar fields (debugLog, permissionReviewLog, yoloMode) are replaced when
 *   present in the override.
 */
export function mergeUnifiedConfigs(
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
): UnifiedPermissionConfig {
  const merged: UnifiedPermissionConfig = {};

  // Scalars: override replaces base when defined
  for (const key of ["debugLog", "permissionReviewLog", "yoloMode"] as const) {
    const value = override[key] ?? base[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Permission: deep-shallow merge
  const basePerm = base.permission;
  const overridePerm = override.permission;
  if (basePerm && overridePerm) {
    merged.permission = mergeFlatPermissions(basePerm, overridePerm);
  } else if (basePerm) {
    merged.permission = basePerm;
  } else if (overridePerm) {
    merged.permission = overridePerm;
  }

  return merged;
}

export interface MergedConfigResult {
  global: UnifiedPermissionConfig;
  project: UnifiedPermissionConfig;
  merged: UnifiedPermissionConfig;
  issues: string[];
}

/**
 * Load global and project configs from the new layout, detect legacy files,
 * merge everything, and collect issues.
 *
 * Merge order:
 * 1. Legacy global policy (if present) — lowest precedence
 * 2. Legacy extension runtime config (if present and path differs from new global)
 * 3. Legacy global config from the pre-Ayu layout
 * 4. New global config
 * 5. Legacy project policy (if present)
 * 6. Legacy project config from the pre-Ayu layout
 * 7. New project config — highest precedence
 *
 * Legacy files are detected and warned about. Their content is parsed with the
 * flat-format parser — legacy-format keys (defaultPolicy, tools, bash, etc.)
 * are not translated and contribute no permission rules.
 */
export function loadAndMergeConfigs(
  agentDir: string,
  cwd: string,
  extensionRoot: string,
): MergedConfigResult {
  const allIssues: string[] = [];

  const newGlobalPath = getGlobalConfigPath(agentDir);
  const newProjectPath = getProjectConfigPath(cwd);
  const legacyGlobalConfigPath = getLegacyGlobalConfigPath(agentDir);
  const legacyGlobalPolicyPath = getLegacyGlobalPolicyPath(agentDir);
  const legacyProjectConfigPath = getLegacyProjectConfigPath(cwd);
  const legacyProjectPolicyPath = getLegacyProjectPolicyPath(cwd);
  const legacyExtConfigPath = getLegacyExtensionConfigPath(extensionRoot);

  // Start with empty
  let merged: UnifiedPermissionConfig = {};

  // 1. Legacy global policy
  if (existsSync(legacyGlobalPolicyPath)) {
    const legacy = loadUnifiedConfig(legacyGlobalPolicyPath);
    allIssues.push(
      `Legacy global policy found at '${legacyGlobalPolicyPath}'. ` +
        `Move it to '${newGlobalPath}':\n` +
        `  mv '${legacyGlobalPolicyPath}' '${newGlobalPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 2. Legacy extension runtime config (only if different from new global path)
  const normalizedLegacyExt = normalize(legacyExtConfigPath);
  const normalizedNewGlobal = normalize(newGlobalPath);
  if (normalizedLegacyExt !== normalizedNewGlobal && existsSync(legacyExtConfigPath)) {
    const legacy = loadUnifiedConfig(legacyExtConfigPath);
    allIssues.push(
      `Legacy extension config found at '${legacyExtConfigPath}'. ` +
        `Move runtime settings to '${newGlobalPath}':\n` +
        `  mv '${legacyExtConfigPath}' '${newGlobalPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 3. Legacy global config from pre-Ayu layout
  if (
    normalize(legacyGlobalConfigPath) !== normalizedNewGlobal &&
    existsSync(legacyGlobalConfigPath)
  ) {
    const legacy = loadUnifiedConfig(legacyGlobalConfigPath);
    allIssues.push(
      `Legacy global config found at '${legacyGlobalConfigPath}'. ` +
        `Move it to '${newGlobalPath}':\n` +
        `  mv '${legacyGlobalConfigPath}' '${newGlobalPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 4. New global config
  const globalResult = loadUnifiedConfig(newGlobalPath);
  allIssues.push(...globalResult.issues);
  const globalConfig = globalResult.config;
  merged = mergeUnifiedConfigs(merged, globalConfig);

  // 5. Legacy project policy
  if (existsSync(legacyProjectPolicyPath)) {
    const legacy = loadUnifiedConfig(legacyProjectPolicyPath);
    allIssues.push(
      `Legacy project policy found at '${legacyProjectPolicyPath}'. ` +
        `Move it to '${newProjectPath}':\n` +
        `  mv '${legacyProjectPolicyPath}' '${newProjectPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 6. Legacy project config from pre-Ayu layout
  if (
    normalize(legacyProjectConfigPath) !== normalize(newProjectPath) &&
    existsSync(legacyProjectConfigPath)
  ) {
    const legacy = loadUnifiedConfig(legacyProjectConfigPath);
    allIssues.push(
      `Legacy project config found at '${legacyProjectConfigPath}'. ` +
        `Move it to '${newProjectPath}':\n` +
        `  mv '${legacyProjectConfigPath}' '${newProjectPath}'`,
    );
    allIssues.push(...legacy.issues);
    merged = mergeUnifiedConfigs(merged, legacy.config);
  }

  // 7. New project config
  const projectResult = loadUnifiedConfig(newProjectPath);
  allIssues.push(...projectResult.issues);
  const projectConfig = projectResult.config;
  merged = mergeUnifiedConfigs(merged, projectConfig);

  return {
    global: globalConfig,
    project: projectConfig,
    merged,
    issues: allIssues,
  };
}

/**
 * Load and normalize a unified config file.
 * Returns an empty config with no issues if the file does not exist.
 * Returns an empty config with an issue if the file cannot be parsed.
 */
export function loadUnifiedConfig(path: string): UnifiedConfigLoadResult {
  if (!existsSync(path)) {
    return { config: {}, issues: [] };
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    return normalizeUnifiedConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: {},
      issues: [`Failed to read config at '${path}': ${message}`],
    };
  }
}

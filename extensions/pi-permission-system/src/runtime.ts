import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, normalize } from "node:path";
import {
  type ExtensionCommandContext,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

import { loadAndMergeConfigs, loadUnifiedConfig } from "./config-loader";
import {
  DEBUG_LOG_FILENAME,
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  joinPathLike,
  REVIEW_LOG_FILENAME,
} from "./config-paths";
import { buildResolvedConfigLogEntry } from "./config-reporter";
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_ROOT,
  ensurePermissionSystemLogsDirectory,
  normalizePermissionSystemConfig,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import { computeExtensionPaths, type ExtensionPaths } from "./extension-paths";

export type { ExtensionPaths } from "./extension-paths";

import { createPermissionSystemLogger } from "./logging";
import { PermissionManager } from "./permission-manager";
import { SessionRules } from "./session-rules";
import type { SkillPromptEntry } from "./skill-prompt-sanitizer";
import { syncPermissionSystemStatus } from "./status";

/**
 * Mutable session state — the subset of ExtensionRuntime that holds
 * per-session fields. `PermissionSession` now owns these for handler
 * use; this interface remains so `ExtensionRuntime` can still serve
 * as the internal composition root (config-modal, RPC handlers).
 */
interface SessionState {
  runtimeContext: ExtensionContext | null;
  permissionManager: PermissionManager;
  readonly sessionRules: SessionRules;
  activeSkillEntries: SkillPromptEntry[];
  lastKnownActiveAgentName: string | null;
  lastActiveToolsCacheKey: string | null;
  lastPromptStateCacheKey: string | null;
}

/**
 * Runtime context object created once inside `piPermissionSystemExtension()`.
 *
 * Holds all path constants (derived from `getAgentDir()` at construction time),
 * mutable extension state, and the log-writing methods — eliminating the
 * module-scope cached constants and setter-injection pattern that previously
 * lived in `src/index.ts`.
 *
 * Tests construct this via `createExtensionRuntime({ agentDir: tmpDir })`
 * without timing issues around `PI_CODING_AGENT_DIR`.
 */
export interface ExtensionRuntime extends ExtensionPaths, SessionState {
  // ── Mutable state (beyond SessionState) ───────────────────────────────────
  config: PermissionSystemExtensionConfig;
  lastConfigWarning: string | null;

  // ── Logging (backed by logger created at construction) ─────────────────
  writeDebugLog(event: string, details?: Record<string, unknown>): void;
  writeReviewLog(event: string, details?: Record<string, unknown>): void;
}

export interface SaveExtensionConfigFsOps {
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: string, encoding: BufferEncoding): void;
  renameSync(oldPath: string, newPath: string): void;
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
}

const DEFAULT_SAVE_EXTENSION_CONFIG_FS_OPS: SaveExtensionConfigFsOps = {
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
};

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Derive Pi project-level config and agents paths from a working directory.
 * Returns null when cwd is absent (headless / global-only config).
 */
export function derivePiProjectPaths(cwd: string | undefined | null): {
  projectGlobalConfigPath: string;
  projectAgentsDir: string;
} | null {
  if (!cwd) {
    return null;
  }
  return {
    projectGlobalConfigPath: getProjectConfigPath(cwd),
    projectAgentsDir: getProjectAgentsDir(cwd),
  };
}

/**
 * Create a new PermissionManager scoped to a working directory's config hierarchy.
 * Pass `cwd` as null/undefined to use global config only.
 */
export function createPermissionManagerForCwd(
  agentDir: string,
  cwd: string | undefined | null,
): PermissionManager {
  const projectPaths = derivePiProjectPaths(cwd);
  return new PermissionManager({
    globalConfigPath: getGlobalConfigPath(agentDir),
    projectGlobalConfigPath: projectPaths?.projectGlobalConfigPath,
    projectAgentsDir: projectPaths?.projectAgentsDir,
  });
}

/**
 * Reload merged config from disk into the runtime.
 * If `ctx` is provided, updates `runtime.runtimeContext` first.
 */
export function refreshExtensionConfig(runtime: ExtensionRuntime, ctx?: ExtensionContext): void {
  if (ctx) {
    runtime.runtimeContext = ctx;
  }
  const cwd = runtime.runtimeContext?.cwd ?? null;
  const mergeResult = loadAndMergeConfigs(runtime.agentDir, cwd ?? "", EXTENSION_ROOT);
  const runtimeConfig = normalizePermissionSystemConfig(mergeResult.merged);
  runtime.config = runtimeConfig;

  if (runtime.runtimeContext?.hasUI) {
    syncPermissionSystemStatus(runtime.runtimeContext, runtimeConfig);
  }

  const warning = mergeResult.issues.length > 0 ? mergeResult.issues.join("\n") : undefined;

  if (warning && warning !== runtime.lastConfigWarning) {
    runtime.lastConfigWarning = warning;
    runtime.runtimeContext?.ui.notify(warning, "warning");
  } else if (!warning) {
    runtime.lastConfigWarning = null;
  }

  runtime.writeDebugLog("config.loaded", {
    warning: warning ?? null,
    debugLog: runtimeConfig.debugLog,
    permissionReviewLog: runtimeConfig.permissionReviewLog,
    yoloMode: runtimeConfig.yoloMode,
  });
}

/**
 * Save updated runtime knobs (debugLog, permissionReviewLog, yoloMode) to the
 * global config file, then update runtime.config and sync UI status.
 */
export function saveExtensionConfig(
  runtime: ExtensionRuntime,
  next: PermissionSystemExtensionConfig,
  ctx: ExtensionCommandContext,
  fsOps: SaveExtensionConfigFsOps = DEFAULT_SAVE_EXTENSION_CONFIG_FS_OPS,
): void {
  const normalized = normalizePermissionSystemConfig(next);
  const globalPath = getGlobalConfigPath(runtime.agentDir);

  const existing = loadUnifiedConfig(globalPath);
  const merged = {
    ...existing.config,
    debugLog: normalized.debugLog,
    permissionReviewLog: normalized.permissionReviewLog,
    yoloMode: normalized.yoloMode,
  };

  const tmpPath = `${globalPath}.tmp`;
  try {
    fsOps.mkdirSync(dirname(globalPath), { recursive: true });
    fsOps.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
    fsOps.renameSync(tmpPath, globalPath);
  } catch (error) {
    try {
      if (fsOps.existsSync(tmpPath)) {
        fsOps.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup failures.
    }
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(
      `Failed to save permission-system config at '${globalPath}': ${message}`,
      "error",
    );
    return;
  }

  runtime.config = normalized;
  syncPermissionSystemStatus(ctx, normalized);
  runtime.lastConfigWarning = null;

  runtime.writeDebugLog("config.saved", {
    debugLog: normalized.debugLog,
    permissionReviewLog: normalized.permissionReviewLog,
    yoloMode: normalized.yoloMode,
  });
}

/**
 * Write the resolved config path set (global, project, legacy) to the review
 * and debug logs.
 */
export function logResolvedConfigPaths(runtime: ExtensionRuntime): void {
  const policyPaths = runtime.permissionManager.getResolvedPolicyPaths();
  const cwd = runtime.runtimeContext?.cwd ?? null;
  const { agentDir } = runtime;
  const legacyGlobalPolicyDetected = existsSync(getLegacyGlobalPolicyPath(agentDir));
  const legacyProjectPolicyDetected = cwd ? existsSync(getLegacyProjectPolicyPath(cwd)) : false;
  const legacyExtConfigPath = getLegacyExtensionConfigPath(EXTENSION_ROOT);
  const newGlobalPath = getGlobalConfigPath(agentDir);
  const legacyExtensionConfigDetected =
    normalize(legacyExtConfigPath) !== normalize(newGlobalPath) && existsSync(legacyExtConfigPath);
  const entry = buildResolvedConfigLogEntry({
    policyPaths,
    legacyGlobalPolicyDetected,
    legacyProjectPolicyDetected,
    legacyExtensionConfigDetected,
  });
  runtime.writeReviewLog("config.resolved", entry as unknown as Record<string, unknown>);
  runtime.writeDebugLog("config.resolved", entry as unknown as Record<string, unknown>);
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a fully-initialized `ExtensionRuntime`.
 *
 * Calls `getAgentDir()` at invocation time (never at module scope), so tests
 * may set `PI_CODING_AGENT_DIR` before calling the factory.
 */
export function createExtensionRuntime(options?: { agentDir?: string }): ExtensionRuntime {
  const agentDir = options?.agentDir ?? getAgentDir();
  const paths = computeExtensionPaths(agentDir);

  // Build a plain-object runtime first so the logger's `getConfig` closure
  // can reference `runtime.config` directly (always reads current value).
  const runtime: ExtensionRuntime = {
    ...paths,
    config: { ...DEFAULT_EXTENSION_CONFIG },
    runtimeContext: null,
    permissionManager: createPermissionManagerForCwd(agentDir, undefined),
    activeSkillEntries: [],
    lastKnownActiveAgentName: null,
    lastActiveToolsCacheKey: null,
    lastPromptStateCacheKey: null,
    lastConfigWarning: null,
    sessionRules: new SessionRules(),
    // Logging methods are replaced below before the runtime escapes this factory.
    /* v8 ignore next -- construction-only placeholder; real logger method is installed below */
    writeDebugLog: () => {},
    /* v8 ignore next -- construction-only placeholder; real logger method is installed below */
    writeReviewLog: () => {},
  };

  const reportedLoggingWarnings = new Set<string>();
  const logger = createPermissionSystemLogger({
    // Reads runtime.config at call time — always current.
    getConfig: () => runtime.config,
    debugLogPath: joinPathLike(paths.globalLogsDir, DEBUG_LOG_FILENAME),
    reviewLogPath: joinPathLike(paths.globalLogsDir, REVIEW_LOG_FILENAME),
    ensureLogsDirectory: () => ensurePermissionSystemLogsDirectory(paths.globalLogsDir),
  });

  const reportLoggingWarning = (message: string): void => {
    if (reportedLoggingWarnings.has(message)) {
      return;
    }
    reportedLoggingWarnings.add(message);
    // Reads runtime.runtimeContext at call time — always current.
    runtime.runtimeContext?.ui.notify(message, "warning");
  };

  runtime.writeDebugLog = (event: string, details: Record<string, unknown> = {}): void => {
    const warning = logger.debug(event, details);
    if (warning) {
      reportLoggingWarning(warning);
    }
  };

  runtime.writeReviewLog = (event: string, details: Record<string, unknown> = {}): void => {
    const warning = logger.review(event, details);
    if (warning) {
      reportLoggingWarning(warning);
    }
  };

  return runtime;
}

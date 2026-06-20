export { loadConfig, loadConfigFromFile, defaultConfig, DEFAULT_EXCLUDES } from "./config";
export { RepoManager } from "./repo-manager";
export type { SafeCheckoutResult } from "./repo-manager";
export {
  getCheckpointRootDir,
  getLegacySessionsDir,
  getRepoDir,
  getGitDir,
  getIndexPath,
  getWorktreeId,
  getWorktreeRegistryPath,
  resolveWorktreeCheckpointStoragePaths,
} from "./resolver";
export {
  cleanupCheckpointStorage,
  cleanupLegacySessionCheckpointStorage,
  cleanupTemporaryCheckpointArtifacts,
} from "./cleanup";
export type {
  CheckpointCleanupOptions,
  CheckpointCleanupResult,
  CheckpointCleanupRetention,
  CheckpointCleanupWorktreeResult,
} from "./cleanup";
export {
  createCheckpointRef,
  encodeStorageComponent,
  isSafeCheckpointRef,
  isSafeStorageComponent,
  validateWorktreeId,
} from "./path-safety";
export { exec, execSafe, type ExecEnv, type Result } from "./exec";
export { parseDiffStats } from "./diff-parser";
export {
  isCheckpointEntry,
  filterCheckpointEntries,
  extractCheckpointData,
  getCheckpointEntries,
  hasLegacyFileState,
} from "./checkpoint-entry";
export { withRepoLock } from "./lock";
export { SessionStateMap } from "./session-state-map";
export { safeRestore } from "./restore";
export type { NavigateTreeOptions, NavigateTreeResult, RestoreResult } from "./restore";
export { createDefaultRepoProvider, type RepoProvider } from "./repo-provider";
export {
  cloneSessionCheckpointStorage,
  ensureSessionCheckpointStorage,
  resolveSessionCheckpointStorage,
  safeCloneSessionCheckpointStorage,
  safeEnsureSessionCheckpointStorage,
} from "./session-checkpoint-storage";
export { bindSessionRepo } from "./session-repo-binder";
export type {
  CloneSessionCheckpointStorageOptions,
  CloneSessionCheckpointStorageResult,
  EnsureSessionCheckpointStorageOptions,
  SessionCheckpointStorageOptions,
  SessionCheckpointStorageResult,
} from "./session-checkpoint-storage";
export type { CheckpointConfig, CheckpointMeta, FileChange } from "./types";
export type { CheckpointEntry } from "./checkpoint-entry";

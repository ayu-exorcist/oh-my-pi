export { loadConfig, loadConfigFromFile, defaultConfig } from "./config";
export { RepoManager } from "./repo-manager";
export type { SafeCheckoutResult } from "./repo-manager";
export { getCheckpointSessionsRoot, getRepoDir, getGitDir, getIndexPath } from "./resolver";
export { exec, execSafe, type ExecEnv, type Result } from "./exec";
export { parseDiffStats } from "./diff-parser";
export {
  isCheckpointEntry,
  filterCheckpointEntries,
  extractCheckpointData,
  getCheckpointEntries,
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
export {
  deleteSessionCheckpointStorage,
  listCheckpointStorageManifests,
  purgeSessionCheckpointStorage,
  readCheckpointStorageManifest,
  writeCheckpointStorageManifest,
} from "./storage-manifest";
export type {
  CloneSessionCheckpointStorageOptions,
  CloneSessionCheckpointStorageResult,
  EnsureSessionCheckpointStorageOptions,
  SessionCheckpointStorageOptions,
  SessionCheckpointStorageResult,
} from "./session-checkpoint-storage";
export type { CheckpointConfig, CheckpointMeta, FileChange } from "./types";
export type { CheckpointEntry } from "./checkpoint-entry";
export type {
  CheckpointStorageManifest,
  CheckpointStorageManifestRecord,
  DeleteSessionCheckpointStorageResult,
} from "./storage-manifest";

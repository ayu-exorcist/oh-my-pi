export { loadConfig, loadConfigFromFile, defaultConfig } from "./config";
export { RepoManager } from "./repo-manager";
export type { SafeCheckoutResult } from "./repo-manager";
export { getRepoDir, getGitDir, getIndexPath } from "./resolver";
export { exec, execSafe, type ExecEnv, type Result } from "./exec";
export { parseDiffStats } from "./diff-parser";
export {
  isRecord,
  isString,
  isNumber,
  isBoolean,
  isStringArray,
  isArrayOf,
  errorMessage,
} from "./guards";
export {
  isCheckpointEntry,
  filterCheckpointEntries,
  extractCheckpointData,
  getCheckpointEntries,
} from "./checkpoint-entry";
export { withRepoLock } from "./lock";
export { createDefaultRepoProvider, type RepoProvider } from "./repo-provider";
export type { CheckpointConfig, CheckpointMeta, FileChange } from "./types";
export type { CheckpointEntry } from "./checkpoint-entry";

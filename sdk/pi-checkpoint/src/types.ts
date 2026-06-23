/**
 * Configuration for the checkpoint engine.
 */
export interface CheckpointConfig {
  /** Whether checkpointing is enabled. */
  readonly enabled: boolean;
  /** Whether to create a checkpoint automatically on every turn. */
  readonly autoCheckpoint: boolean;
  /** Behavior when forking a session. */
  readonly restoreOnFork: "always" | "never";
  /** Behavior when cloning a session. */
  readonly restoreOnClone: "always" | "never";
  /** Behavior when resuming a session. */
  readonly restoreOnResume: "always" | "never";
  /** Behavior when navigating Pi's session tree. Configured via `ayu.rewind.restoreOnTree`. */
  readonly restoreOnTree: "always" | "ask" | "never";
  /** Default instructions for summarization during rewind. */
  readonly defaultSummaryInstructions: string;
  /** Final internal exclude patterns written to checkpoint storage. */
  readonly exclude: readonly string[];
  /** User include patterns re-applied after internal and user excludes. */
  readonly include: readonly string[];
  /** Skip files larger than this many MB when staging checkpoints. */
  readonly maxFileMB: number | undefined;
}

/**
 * Statistics for a single file change within a checkpoint.
 */
export interface FileChange {
  /** Relative path of the changed file. */
  readonly path: string;
  /** Number of lines added. */
  readonly added: number;
  /** Number of lines removed. */
  readonly removed: number;
}

/**
 * Metadata stored for each checkpoint.
 */
export interface CheckpointMeta {
  /** Session entry id that triggered this checkpoint. */
  readonly entryId: string;
  /** Git commit hash of the checkpoint. */
  readonly commitHash: string;
  /** Unix timestamp when the checkpoint was created. */
  readonly timestamp: number;
  /** Truncated user prompt that created this checkpoint. */
  readonly prompt: string;
  /** Number of unique files touched in this turn. */
  readonly fileCount: number;
  /** Per-file change statistics. */
  readonly fileChanges: readonly FileChange[];
}

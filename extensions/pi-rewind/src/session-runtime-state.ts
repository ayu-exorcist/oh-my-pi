import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getCheckpointEntries,
  loadConfig,
  SessionStateMap,
  type CheckpointConfig,
  type CheckpointEntry,
} from "@ayulab/pi-checkpoint";
import type { AutoCheckpointProducer } from "./auto-checkpoint";
import {
  buildBranchToEntry,
  checkpointHasFileChanges,
  createSessionTaskQueue,
  hasCheckpointFileChanges,
  mergeCheckpointEntries,
  needsCodeSync,
  resolveBranchCodeCommit,
  resolveTreeTargetCommit,
  type TreeRestoreIntent,
  type TreeRestoreMode,
} from "./index-helpers";
import type { TreeEntryRecord } from "./utils/tree-entry";

export class TreeRestoreCoordinator {
  private readonly pending = new SessionStateMap<TreeRestoreIntent>();
  private readonly suppressed = new SessionStateMap<boolean>();
  private readonly notifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();

  reset(sessionId: string): void {
    this.pending.delete(sessionId);
    this.notifiers.delete(sessionId);
    this.suppressed.delete(sessionId);
  }

  isSuppressed(sessionId: string): boolean {
    return this.suppressed.getOrUndefined(sessionId) === true;
  }

  suppress(sessionId: string): void {
    this.suppressed.set(sessionId, true);
  }

  clearSuppression(sessionId: string): void {
    this.suppressed.delete(sessionId);
  }

  consumeSuppressedTree(sessionId: string): boolean {
    if (!this.isSuppressed(sessionId)) return false;
    this.clearSuppression(sessionId);
    this.pending.delete(sessionId);
    return true;
  }

  setConversationPending(sessionId: string, targetId: string): void {
    this.pending.set(sessionId, { targetId, mode: "Restore conversation" });
    this.notifiers.delete(sessionId);
  }

  setCodePending(
    sessionId: string,
    intent: TreeRestoreIntent,
    ui: ExtensionContext["ui"] | undefined,
  ): void {
    this.pending.set(sessionId, intent);
    this.notifiers.set(sessionId, ui);
  }

  clearPending(sessionId: string): void {
    this.pending.delete(sessionId);
    this.notifiers.delete(sessionId);
  }

  consumePending(sessionId: string): TreeRestoreIntent | undefined {
    const intent = this.pending.getOrUndefined(sessionId);
    this.pending.delete(sessionId);
    return intent;
  }

  consumeNotifier(
    sessionId: string,
    currentUi: ExtensionContext["ui"] | undefined,
    sessionUi: ExtensionContext["ui"] | undefined,
  ): ExtensionContext["ui"] | undefined {
    const ui = currentUi ?? this.notifiers.getOrUndefined(sessionId) ?? sessionUi;
    this.notifiers.delete(sessionId);
    return ui;
  }
}

interface PlanTreeCodeRestoreOptions {
  readonly sessionId: string;
  readonly targetId: string;
  readonly entries: readonly unknown[];
  readonly hasUI: boolean;
  readonly ui: ExtensionContext["ui"] | undefined;
}

export class RewindSessionRuntimeState {
  readonly producers = new SessionStateMap<AutoCheckpointProducer>();
  readonly sessionTasks = createSessionTaskQueue();
  readonly lastCheckpointTurnIds = new SessionStateMap<string>();
  readonly treeRestores = new TreeRestoreCoordinator();
  readonly sessionHasCheckpointFileChanges = new SessionStateMap<boolean>();
  readonly sessionNotifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();
  readonly sessionConfigs = new SessionStateMap<CheckpointConfig>();
  readonly sessionTreeRestoreModes = new SessionStateMap<TreeRestoreMode>();
  readonly sessionFiles = new SessionStateMap<string | undefined>();
  readonly sessionCwds = new SessionStateMap<string>();
  readonly sessionSyncedCodeCommits = new SessionStateMap<string>();
  readonly sessionCheckpointEntries = new SessionStateMap<readonly CheckpointEntry[]>();

  getSessionConfig(sessionId: string): CheckpointConfig {
    return this.sessionConfigs.getOrUndefined(sessionId) ?? loadConfig({});
  }

  getSessionTreeRestoreMode(sessionId: string): TreeRestoreMode {
    return this.sessionTreeRestoreModes.getOrUndefined(sessionId) ?? "ask";
  }

  startTreeNavigation(sessionId: string, targetId: string): boolean {
    if (this.treeRestores.isSuppressed(sessionId)) return false;
    this.treeRestores.setConversationPending(sessionId, targetId);
    return true;
  }

  async planTreeCodeRestore(options: PlanTreeCodeRestoreOptions): Promise<void> {
    const { sessionId, targetId, entries, hasUI, ui } = options;
    const treeRestoreMode = this.getSessionTreeRestoreMode(sessionId);
    const checkpoints = mergeCheckpointEntries(
      entries,
      this.sessionCheckpointEntries.getOrUndefined(sessionId),
    );
    const hasKnownFileChanges =
      this.sessionHasCheckpointFileChanges.getOrUndefined(sessionId) === true ||
      checkpoints.some(checkpointHasFileChanges);
    this.sessionHasCheckpointFileChanges.set(sessionId, hasKnownFileChanges);

    const targetBranch = buildBranchToEntry(entries, targetId);
    const targetCommit = resolveTreeTargetCommit(entries, targetBranch, targetId, checkpoints);
    const shouldSyncCode =
      hasKnownFileChanges &&
      needsCodeSync(this.sessionSyncedCodeCommits.getOrUndefined(sessionId), targetCommit);

    if (treeRestoreMode === "always") {
      if (!shouldSyncCode || !targetCommit) return;

      const restoreUi = hasUI ? ui : this.sessionNotifiers.getOrUndefined(sessionId);
      this.treeRestores.setCodePending(
        sessionId,
        {
          targetId,
          mode: "Restore code and conversation",
          targetCommit,
        },
        restoreUi,
      );
      return;
    }

    if (treeRestoreMode === "ask") {
      if (!hasUI || !ui || !shouldSyncCode || !targetCommit) return;

      const syncFiles = await ui.select("Sync files?", ["Yes", "No"]);
      if (syncFiles === "Yes") {
        this.treeRestores.setCodePending(
          sessionId,
          {
            targetId,
            mode: "Restore code and conversation",
            targetCommit,
          },
          ui,
        );
      }
      return;
    }

    this.treeRestores.clearPending(sessionId);
  }

  resetSession(
    sessionId: string,
    entries: readonly unknown[],
    branch: readonly TreeEntryRecord[],
    initializeSyncedCodeCommit: boolean,
  ): void {
    this.producers.delete(sessionId);
    this.sessionTasks.delete(sessionId);
    this.lastCheckpointTurnIds.delete(sessionId);
    this.treeRestores.reset(sessionId);
    this.sessionHasCheckpointFileChanges.set(sessionId, hasCheckpointFileChanges(entries));
    this.sessionCheckpointEntries.set(sessionId, getCheckpointEntries(entries));
    const currentCommit = initializeSyncedCodeCommit
      ? resolveBranchCodeCommit(entries, branch)
      : undefined;
    if (currentCommit) {
      this.sessionSyncedCodeCommits.set(sessionId, currentCommit);
    } else {
      this.sessionSyncedCodeCommits.delete(sessionId);
    }
  }
}

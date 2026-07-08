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
  createSessionTaskQueue,
  hasCheckpointFileChanges,
  resolveBranchCodeCommit,
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

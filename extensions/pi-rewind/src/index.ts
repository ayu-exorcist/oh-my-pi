import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  loadConfig,
  createDefaultRepoProvider,
  safeCloneSessionCheckpointStorage,
  bindSessionRepo,
  getRepoDir,
  getCheckpointEntries,
  resolveSessionCheckpointStorage,
} from "@ayulab/pi-checkpoint";
import { SessionStateMap } from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { errorMessage, isRecord } from "@ayulab/runtime-core";
import { extractPrompt, findLastUserEntry } from "./utils/prompt";
import { registerCheckpointStorageCommand } from "./commands/checkpoint";
import { registerRewind } from "./commands/rewind";
import { AutoCheckpointProducer } from "./auto-checkpoint";
import { getTreeEventRecord, toTreeEntryRecords, type TreeEntryRecord } from "./utils/tree-entry";
import {
  CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE,
  CHECKPOINT_STORAGE_MISSING_MESSAGE,
  buildBranchToEntry,
  checkpointHasFileChanges,
  clearCodeRestoreWarning,
  configureRepo,
  createAutoCheckpointProducer,
  createSessionTaskQueue,
  findCleanCheckpointCommit,
  findLatestBranchCheckpointFromList,
  hasCheckpointFileChanges,
  mergeCheckpointEntries,
  mergeSettingsRecords,
  needsCodeSync,
  notifySafeCheckoutFailure,
  notifyUnusableResumeStorage,
  readSettingsRecord,
  rememberCheckpointFileChanges,
  resolveBranchCodeCommit,
  resolveTreeRestoreMode,
  resolveTreeTargetCommit,
  restoreCloneCodeState,
  restoreForkCodeState,
  safeRestoreTreeCodeState,
  showCodeRestoreWarning,
  syncCheckpointStorageManifest,
  type ForkIntent,
  type RestoreRepoResult,
  type TreeRestoreIntent,
  type TreeRestoreMode,
} from "./index-helpers";

export function isForkIntentRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function isForkIntent(value: unknown): value is ForkIntent {
  if (!isForkIntentRecord(value)) return false;

  return (
    typeof value.entryId === "string" && (value.position === "before" || value.position === "at")
  );
}

export function getForkIntentPath(sessionFile: string | undefined): string {
  return path.join(getRepoDir(sessionFile), "fork-intent.json");
}

export async function writeForkIntent(
  sessionFile: string | undefined,
  intent: ForkIntent | undefined,
): Promise<void> {
  if (!sessionFile || !intent) return;

  const intentPath = getForkIntentPath(sessionFile);
  await mkdir(path.dirname(intentPath), { recursive: true });
  await writeFile(intentPath, JSON.stringify(intent), "utf8");
}

export async function readForkIntent(
  sessionFile: string | undefined,
): Promise<ForkIntent | undefined> {
  if (!sessionFile) return undefined;

  try {
    const intentPath = getForkIntentPath(sessionFile);
    const raw = await readFile(intentPath, "utf8");
    await rm(intentPath, { force: true });
    const parsed: unknown = JSON.parse(raw);
    return isForkIntent(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pi extension entry point — sets up automatic per-turn checkpoints
 * and registers the `/rewind` command.
 *
 * @param pi - Extension API.
 * @param provider - Optional repo provider for testing. Defaults to a
 *   Map-backed adapter that binds repos per session id.
 */
export default function (pi: ExtensionAPI, provider?: RepoProvider) {
  const repos = provider ?? createDefaultRepoProvider();

  const producers = new SessionStateMap<AutoCheckpointProducer>();
  const sessionTasks = createSessionTaskQueue();
  const lastCheckpointTurnIds = new SessionStateMap<string>();
  const pendingTreeRestores = new SessionStateMap<TreeRestoreIntent>();
  const suppressedTreeRestores = new SessionStateMap<boolean>();
  const sessionHasCheckpointFileChanges = new SessionStateMap<boolean>();
  const treeRestoreNotifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();
  const sessionNotifiers = new SessionStateMap<ExtensionContext["ui"] | undefined>();
  const sessionConfigs = new SessionStateMap<CheckpointConfig>();
  const sessionTreeRestoreModes = new SessionStateMap<TreeRestoreMode>();
  const sessionFiles = new SessionStateMap<string | undefined>();
  const sessionCwds = new SessionStateMap<string>();
  const sessionSyncedCodeCommits = new SessionStateMap<string>();
  const sessionCheckpointEntries = new SessionStateMap<readonly CheckpointEntry[]>();

  function getSessionConfig(sessionId: string): CheckpointConfig {
    return sessionConfigs.getOrUndefined(sessionId) ?? loadConfig({});
  }

  function getSessionTreeRestoreMode(sessionId: string): TreeRestoreMode {
    return sessionTreeRestoreModes.getOrUndefined(sessionId) ?? "ask";
  }

  function resetSessionRuntimeState(
    sessionId: string,
    entries: readonly unknown[],
    branch: readonly TreeEntryRecord[],
    initializeSyncedCodeCommit: boolean,
  ): void {
    producers.delete(sessionId);
    sessionTasks.delete(sessionId);
    lastCheckpointTurnIds.delete(sessionId);
    pendingTreeRestores.delete(sessionId);
    treeRestoreNotifiers.delete(sessionId);
    suppressedTreeRestores.delete(sessionId);
    sessionHasCheckpointFileChanges.set(sessionId, hasCheckpointFileChanges(entries));
    sessionCheckpointEntries.set(sessionId, getCheckpointEntries(entries));
    const currentCommit = initializeSyncedCodeCommit
      ? resolveBranchCodeCommit(entries, branch)
      : undefined;
    if (currentCommit) {
      sessionSyncedCodeCommits.set(sessionId, currentCommit);
    } else {
      sessionSyncedCodeCommits.delete(sessionId);
    }
  }

  async function getOrCreateAutoCheckpointProducer(
    sessionId: string,
    ctx: ExtensionContext,
    config: CheckpointConfig,
  ): Promise<AutoCheckpointProducer | undefined> {
    const existing = producers.getOrUndefined(sessionId);
    if (existing) return existing;
    /* v8 ignore next */
    if (!config.enabled || !config.autoCheckpoint) return undefined;

    const repo = await bindSessionRepo(
      sessionId,
      ctx.sessionManager.getSessionFile(),
      ctx.cwd,
      repos,
      { exclude: config.exclude },
    );
    configureRepo(repo, config);

    const producer = createAutoCheckpointProducer(repo, config);
    producers.set(sessionId, producer);
    return producer;
  }

  async function resolveRepoForRestore(
    sessionId: string,
    sessionFile: string | undefined,
    cwd: string,
    config: CheckpointConfig,
  ): Promise<RestoreRepoResult> {
    const storage = await resolveSessionCheckpointStorage({ sessionFile, cwd });
    if (!storage.ok) return { ok: false, reason: "not-found" };

    const repo = await bindSessionRepo(sessionId, sessionFile, cwd, repos);
    /* v8 ignore next */
    if (!repo) return { ok: false, reason: "not-found" };

    configureRepo(repo, config);
    try {
      await repo.lockedSetExclude(config.exclude);
    } catch (error) {
      return { ok: false, reason: "unusable", message: errorMessage(error) };
    }

    return { ok: true, repo };
  }

  async function appendCheckpoint(
    sessionId: string,
    sessionFile: string | undefined,
    cwd: string,
    entries: readonly SessionEntry[],
    entry: CheckpointEntry,
  ): Promise<void> {
    if (lastCheckpointTurnIds.getOrUndefined(sessionId) === entry.turnId) return;
    lastCheckpointTurnIds.set(sessionId, entry.turnId);
    rememberCheckpointFileChanges(sessionHasCheckpointFileChanges, sessionId, [entry]);
    const checkpointEntries = sessionCheckpointEntries.get(sessionId, Array<CheckpointEntry>);
    sessionCheckpointEntries.set(sessionId, [...checkpointEntries, entry]);
    sessionSyncedCodeCommits.set(sessionId, entry.afterCommit);
    pi.appendEntry("pi-checkpoint", entry);
    await syncCheckpointStorageManifest(sessionFile, sessionId, cwd, entries, entry.prompt);
  }

  let pendingForkIntent: ForkIntent | undefined;

  pi.on("session_before_fork", async (event) => {
    pendingForkIntent = {
      entryId: event.entryId,
      position: event.position,
    };
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "fork") {
      await writeForkIntent(event.targetSessionFile, pendingForkIntent);
    }
    pendingForkIntent = undefined;
  });

  pi.on("session_start", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId();

    // Merge raw settings first so project files inherit missing values from global settings
    // before the checkpoint defaults are applied.
    const globalSettings = await readSettingsRecord(path.join(os.homedir(), ".pi", "agent"));
    const projectSettings = await readSettingsRecord(path.join(ctx.cwd, ".pi"));
    const mergedSettings = mergeSettingsRecords(globalSettings, projectSettings);
    const baseConfig = loadConfig(mergedSettings);
    const treeRestoreMode = resolveTreeRestoreMode(mergedSettings);
    const config: CheckpointConfig = {
      ...baseConfig,
      restoreOnTree: treeRestoreMode !== "never",
    };
    sessionConfigs.set(sessionId, config);
    sessionTreeRestoreModes.set(sessionId, treeRestoreMode);
    sessionFiles.set(sessionId, sessionFile);
    sessionCwds.set(sessionId, ctx.cwd);
    sessionNotifiers.set(sessionId, ctx.hasUI ? ctx.ui : undefined);
    clearCodeRestoreWarning(ctx.hasUI ? ctx.ui : undefined);

    if (event.reason === "fork") {
      const entries = ctx.sessionManager.getEntries();
      resetSessionRuntimeState(sessionId, entries, ctx.sessionManager.getBranch(), false);
      const forkIntent = await readForkIntent(sessionFile);
      if (!event.previousSessionFile) return;

      const storage = await safeCloneSessionCheckpointStorage({
        previousSessionFile: event.previousSessionFile,
        sessionFile,
        cwd: ctx.cwd,
        exclude: config.exclude,
      });

      if (!storage.ok) return;

      configureRepo(storage.repo, config);
      repos.setRepo(sessionId, storage.repo);
      producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));

      await syncCheckpointStorageManifest(sessionFile, sessionId, ctx.cwd, entries);
      if (forkIntent?.position === "at") {
        if (config.restoreOnClone) {
          const restoredCommit = await restoreCloneCodeState(
            storage.repo,
            entries,
            forkIntent.entryId,
            ctx.hasUI ? ctx.ui : undefined,
          );
          if (restoredCommit) sessionSyncedCodeCommits.set(sessionId, restoredCommit);
        }
      } else if (config.restoreOnFork) {
        const restoredCommit = await restoreForkCodeState(
          storage.repo,
          entries,
          ctx.sessionManager.getBranch(),
          forkIntent?.entryId,
          ctx.hasUI ? ctx.ui : undefined,
        );
        if (restoredCommit) sessionSyncedCodeCommits.set(sessionId, restoredCommit);
      }
      return;
    }

    const sessionEntries = ctx.sessionManager.getEntries();
    resetSessionRuntimeState(
      sessionId,
      sessionEntries,
      ctx.sessionManager.getBranch(),
      event.reason === "resume" || event.reason === "startup",
    );

    if (event.reason === "resume" || event.reason === "startup") {
      const storage = await resolveSessionCheckpointStorage({ sessionFile, cwd: ctx.cwd });
      if (!storage.ok && hasCheckpointFileChanges(sessionEntries)) {
        showCodeRestoreWarning(
          ctx.hasUI ? ctx.ui : undefined,
          CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE,
        );
      }
    }

    if ((event.reason === "resume" || event.reason === "startup") && config.restoreOnResume) {
      const entries = ctx.sessionManager.getEntries();
      const targetCommit = resolveTreeTargetCommit(
        entries,
        ctx.sessionManager.getBranch(),
        undefined,
      );
      if (!targetCommit) return;

      const restoreRepo = await resolveRepoForRestore(sessionId, sessionFile, ctx.cwd, config);
      if (!restoreRepo.ok) {
        if (restoreRepo.reason === "not-found") {
          showCodeRestoreWarning(
            ctx.hasUI ? ctx.ui : undefined,
            CHECKPOINT_STORAGE_MISSING_MESSAGE,
          );
        } else {
          notifyUnusableResumeStorage(ctx.hasUI ? ctx.ui : undefined, restoreRepo.message);
        }
        return;
      }

      await syncCheckpointStorageManifest(sessionFile, sessionId, ctx.cwd, sessionEntries);

      const result = await restoreRepo.repo.safeCheckout(targetCommit);
      if (result.ok) {
        sessionSyncedCodeCommits.set(sessionId, targetCommit);
      } else {
        notifySafeCheckoutFailure(
          ctx.hasUI ? ctx.ui : undefined,
          result,
          "Skipped file restore because the workspace has changes that are not captured by this session's checkpoint history.",
          "Could not verify the workspace is clean. Clean up workspace changes before resuming checkpoint state.",
          "Resume file restore failed",
          "Resume file restore failed and rollback also failed",
        );
      }
    }
  });

  async function finalizeCheckpointForSession(ctx: ExtensionContext): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const result = await producer.finalizeRun();
      if (result.ok) {
        await appendCheckpoint(
          sessionId,
          ctx.sessionManager.getSessionFile(),
          ctx.cwd,
          ctx.sessionManager.getEntries(),
          result.entry,
        );
        return;
      }

      if (result.message && ctx.hasUI) {
        ctx.ui.notify(result.message, "warning");
      }
    });
  }

  async function startCheckpointForLatestUser(
    sessionId: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    await sessionTasks.run(sessionId, async () => {
      const config = getSessionConfig(sessionId);
      if (!config.enabled || !config.autoCheckpoint) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      const producer = await getOrCreateAutoCheckpointProducer(sessionId, ctx, config);
      /* c8 ignore next */
      if (!producer) return;

      const result = await producer.turnStart({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf),
      });

      if (result.ok) {
        for (const entry of result.entries) {
          await appendCheckpoint(
            sessionId,
            ctx.sessionManager.getSessionFile(),
            ctx.cwd,
            ctx.sessionManager.getEntries(),
            entry,
          );
        }
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(result.message, "warning");
      }
    });
  }

  pi.on("input", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    clearCodeRestoreWarning(ctx.hasUI ? ctx.ui : sessionNotifiers.getOrUndefined(sessionId));
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sessionId = ctx.sessionManager.getSessionId();
    await startCheckpointForLatestUser(sessionId, ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await sessionTasks.run(sessionId, async () => {
      const producer = producers.getOrUndefined(sessionId);
      if (!producer) return;

      const leaf = findLastUserEntry(ctx.sessionManager.getBranch());
      if (!leaf) return;

      await producer.turnEnd({
        userEntryId: leaf.id,
        prompt: extractPrompt(leaf),
      });
    });
  });

  pi.on("agent_end", async (_event, ctx) => {
    await finalizeCheckpointForSession(ctx);
  });

  pi.on("session_before_tree", async (event, ctx) => {
    const treeEvent = getTreeEventRecord(event);
    const targetId = treeEvent?.targetId;
    if (!targetId) return;

    const sessionId = ctx.sessionManager.getSessionId();
    const treeRestoreMode = getSessionTreeRestoreMode(sessionId);
    if (suppressedTreeRestores.getOrUndefined(sessionId)) return;

    pendingTreeRestores.set(sessionId, { targetId, mode: "Restore conversation" });
    treeRestoreNotifiers.delete(sessionId);

    // Summarise or Summarize with custom prompt → behave like native /tree
    // (conversation-only navigation, no file restore).
    // When userWantsSummary is undefined (e.g. legacy pi-coding-agent),
    // treat it as "not explicitly requesting summary" so that restoreOnTree
    // settings can still apply.
    if (treeEvent.userWantsSummary === true) return;

    await finalizeCheckpointForSession(ctx);
    const entries = ctx.sessionManager.getEntries();
    const checkpoints = mergeCheckpointEntries(
      entries,
      sessionCheckpointEntries.getOrUndefined(sessionId),
    );
    const hasKnownFileChanges =
      sessionHasCheckpointFileChanges.getOrUndefined(sessionId) === true ||
      checkpoints.some(checkpointHasFileChanges);
    sessionHasCheckpointFileChanges.set(sessionId, hasKnownFileChanges);

    const targetBranch = buildBranchToEntry(entries, targetId);
    const targetCommit = resolveTreeTargetCommit(entries, targetBranch, targetId, checkpoints);
    const shouldSyncCode =
      hasKnownFileChanges &&
      needsCodeSync(sessionSyncedCodeCommits.getOrUndefined(sessionId), targetCommit);

    if (treeRestoreMode === "always") {
      if (!shouldSyncCode || !targetCommit) return;

      const restoreUi = ctx.hasUI ? ctx.ui : sessionNotifiers.getOrUndefined(sessionId);
      pendingTreeRestores.set(sessionId, {
        targetId,
        mode: "Restore code and conversation",
        targetCommit,
      });
      treeRestoreNotifiers.set(sessionId, restoreUi);
      return;
    }

    if (treeRestoreMode === "ask") {
      if (!ctx.hasUI || !shouldSyncCode || !targetCommit) return;

      const syncFiles = await ctx.ui.select("Sync files?", ["Yes", "No"]);
      if (syncFiles === "Yes") {
        pendingTreeRestores.set(sessionId, {
          targetId,
          mode: "Restore code and conversation",
          targetCommit,
        });
        treeRestoreNotifiers.set(sessionId, ctx.ui);
      }
      return;
    }

    // never — do nothing, keep mode as "Restore conversation"
    pendingTreeRestores.delete(sessionId);
    treeRestoreNotifiers.delete(sessionId);
  });

  pi.on("session_tree", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (suppressedTreeRestores.getOrUndefined(sessionId)) {
      suppressedTreeRestores.delete(sessionId);
      pendingTreeRestores.delete(sessionId);
      return;
    }

    const restoreIntent = pendingTreeRestores.getOrUndefined(sessionId);
    pendingTreeRestores.delete(sessionId);
    const restoreUi = ctx.hasUI
      ? ctx.ui
      : (treeRestoreNotifiers.getOrUndefined(sessionId) ??
        sessionNotifiers.getOrUndefined(sessionId));
    treeRestoreNotifiers.delete(sessionId);
    const config = getSessionConfig(sessionId);
    const treeRestoreMode = getSessionTreeRestoreMode(sessionId);
    if (restoreIntent?.mode === "Restore conversation") return;
    if (!restoreIntent && treeRestoreMode !== "always") return;

    const entries = ctx.sessionManager.getEntries();
    const checkpoints = mergeCheckpointEntries(
      entries,
      sessionCheckpointEntries.getOrUndefined(sessionId),
    );
    const treeEvent = getTreeEventRecord(event);
    const currentBranch = toTreeEntryRecords(ctx.sessionManager.getBranch());
    const oldLeafId = treeEvent?.oldLeafId;
    const oldBranch = oldLeafId ? buildBranchToEntry(entries, oldLeafId) : currentBranch;
    const targetId = restoreIntent?.targetId;
    const targetLeafId = targetId ?? treeEvent?.newLeafId;
    const targetBranch = targetLeafId ? buildBranchToEntry(entries, targetLeafId) : currentBranch;
    const targetCommit =
      restoreIntent?.targetCommit ??
      resolveTreeTargetCommit(entries, targetBranch, targetId, checkpoints);
    if (!needsCodeSync(sessionSyncedCodeCommits.getOrUndefined(sessionId), targetCommit)) return;

    const cwd = sessionCwds.getOrUndefined(sessionId) ?? ctx.cwd;
    const sessionFileForRestore =
      sessionFiles.getOrUndefined(sessionId) ?? ctx.sessionManager.getSessionFile();
    clearCodeRestoreWarning(restoreUi);
    const restoreRepo = await resolveRepoForRestore(sessionId, sessionFileForRestore, cwd, config);
    if (!restoreRepo.ok) {
      if (restoreRepo.reason === "not-found") {
        showCodeRestoreWarning(restoreUi, CHECKPOINT_STORAGE_MISSING_MESSAGE);
      } else {
        notifyUnusableResumeStorage(restoreUi, restoreRepo.message);
      }
      return;
    }
    const repo = restoreRepo.repo;

    const dirtyBaseCommit =
      treeRestoreMode === "always"
        ? undefined
        : ((await findCleanCheckpointCommit(repo, checkpoints)) ??
          findLatestBranchCheckpointFromList(checkpoints, oldBranch)?.afterCommit);

    const restored = await safeRestoreTreeCodeState(repo, targetCommit, dirtyBaseCommit, restoreUi);
    if (restored && targetCommit) {
      sessionSyncedCodeCommits.set(sessionId, targetCommit);
    }
  });

  registerCheckpointStorageCommand(pi);
  registerRewind(
    pi,
    async (sessionId) => {
      const config = getSessionConfig(sessionId);
      const sessionFileForRestore = sessionFiles.getOrUndefined(sessionId);
      const cwd = sessionCwds.getOrUndefined(sessionId);
      if (!cwd) {
        return {
          ok: false,
          message: "Checkpoint extension is not ready for this session.",
          level: "warning",
        };
      }

      const restoreRepo = await resolveRepoForRestore(
        sessionId,
        sessionFileForRestore,
        cwd,
        config,
      );
      if (restoreRepo.ok) return { ok: true, repo: restoreRepo.repo };
      if (restoreRepo.reason === "not-found") {
        return {
          ok: false,
          message:
            "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
          level: "warning",
        };
      }

      return {
        ok: false,
        message: `Checkpoint storage could not be prepared for rewind: ${restoreRepo.message}`,
        level: "error",
      };
    },
    (sessionId) => {
      suppressedTreeRestores.set(sessionId, true);
    },
    (sessionId) => {
      suppressedTreeRestores.delete(sessionId);
    },
    (sessionId) => sessionSyncedCodeCommits.getOrUndefined(sessionId),
    (sessionId, commitHash) => {
      sessionSyncedCodeCommits.set(sessionId, commitHash);
    },
  );
}

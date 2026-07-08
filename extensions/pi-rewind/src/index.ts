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
  resolveSessionCheckpointStorage,
} from "@ayulab/pi-checkpoint";
import type { RepoProvider, CheckpointConfig, CheckpointEntry } from "@ayulab/pi-checkpoint";
import { errorMessage, isRecord } from "@ayulab/runtime-core";
import { extractPrompt, findLastUserEntry } from "./utils/prompt";
import { registerCheckpointStorageCommand } from "./commands/checkpoint";
import { registerRewind } from "./commands/rewind";
import { AutoCheckpointProducer, type AutoCheckpointAssistantStopReason } from "./auto-checkpoint";
import { RewindSessionRuntimeState } from "./session-runtime-state";
import { getTreeEventRecord, toTreeEntryRecords } from "./utils/tree-entry";
import {
  CHECKPOINT_SESSION_STORAGE_MISSING_MESSAGE,
  CHECKPOINT_STORAGE_MISSING_MESSAGE,
  buildBranchToEntry,
  clearCodeRestoreWarning,
  configureRepo,
  createAutoCheckpointProducer,
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
  resolveTreeRestoreMode,
  resolveTreeTargetCommit,
  restoreCloneCodeState,
  restoreForkCodeState,
  safeRestoreTreeCodeState,
  showCodeRestoreWarning,
  syncCheckpointStorageManifest,
  type ForkIntent,
  type RestoreRepoResult,
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

function isAssistantStopReason(value: unknown): value is AutoCheckpointAssistantStopReason {
  return (
    value === "stop" ||
    value === "length" ||
    value === "toolUse" ||
    value === "error" ||
    value === "aborted"
  );
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

  const runtime = new RewindSessionRuntimeState();

  async function getOrCreateAutoCheckpointProducer(
    sessionId: string,
    ctx: ExtensionContext,
    config: CheckpointConfig,
  ): Promise<AutoCheckpointProducer | undefined> {
    const existing = runtime.producers.getOrUndefined(sessionId);
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
    runtime.producers.set(sessionId, producer);
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
    if (runtime.lastCheckpointTurnIds.getOrUndefined(sessionId) === entry.turnId) return;
    runtime.lastCheckpointTurnIds.set(sessionId, entry.turnId);
    rememberCheckpointFileChanges(runtime.sessionHasCheckpointFileChanges, sessionId, [entry]);
    const checkpointEntries = runtime.sessionCheckpointEntries.get(
      sessionId,
      Array<CheckpointEntry>,
    );
    runtime.sessionCheckpointEntries.set(sessionId, [...checkpointEntries, entry]);
    runtime.sessionSyncedCodeCommits.set(sessionId, entry.afterCommit);
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

  pi.on("session_shutdown", async (event, ctx) => {
    await finalizeCheckpointForSession(ctx, { force: true });
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
    runtime.sessionConfigs.set(sessionId, config);
    runtime.sessionTreeRestoreModes.set(sessionId, treeRestoreMode);
    runtime.sessionFiles.set(sessionId, sessionFile);
    runtime.sessionCwds.set(sessionId, ctx.cwd);
    runtime.sessionNotifiers.set(sessionId, ctx.hasUI ? ctx.ui : undefined);
    clearCodeRestoreWarning(ctx.hasUI ? ctx.ui : undefined);

    if (event.reason === "fork") {
      const entries = ctx.sessionManager.getEntries();
      runtime.resetSession(sessionId, entries, ctx.sessionManager.getBranch(), false);
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
      runtime.producers.set(sessionId, createAutoCheckpointProducer(storage.repo, config));

      await syncCheckpointStorageManifest(sessionFile, sessionId, ctx.cwd, entries);
      if (forkIntent?.position === "at") {
        if (config.restoreOnClone) {
          const restoredCommit = await restoreCloneCodeState(
            storage.repo,
            entries,
            forkIntent.entryId,
            ctx.hasUI ? ctx.ui : undefined,
          );
          if (restoredCommit) runtime.sessionSyncedCodeCommits.set(sessionId, restoredCommit);
        }
      } else if (config.restoreOnFork) {
        const restoredCommit = await restoreForkCodeState(
          storage.repo,
          entries,
          ctx.sessionManager.getBranch(),
          forkIntent?.entryId,
          ctx.hasUI ? ctx.ui : undefined,
        );
        if (restoredCommit) runtime.sessionSyncedCodeCommits.set(sessionId, restoredCommit);
      }
      return;
    }

    const sessionEntries = ctx.sessionManager.getEntries();
    runtime.resetSession(
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
        runtime.sessionSyncedCodeCommits.set(sessionId, targetCommit);
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

  async function finalizeCheckpointForSession(
    ctx: ExtensionContext,
    options?: { readonly force?: boolean },
  ): Promise<void> {
    const sessionId = ctx.sessionManager.getSessionId();
    await runtime.sessionTasks.run(sessionId, async () => {
      const producer = runtime.producers.getOrUndefined(sessionId);
      if (!producer) return;
      if (!options?.force && !producer.shouldFinalizeOnAgentEnd()) return;

      const result = await producer.finalizeRun();
      if (result.ok) {
        const sessionFile =
          runtime.sessionFiles.getOrUndefined(sessionId) ?? ctx.sessionManager.getSessionFile?.();
        const cwd = runtime.sessionCwds.getOrUndefined(sessionId) ?? ctx.cwd;
        await appendCheckpoint(
          sessionId,
          sessionFile,
          cwd,
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
    await runtime.sessionTasks.run(sessionId, async () => {
      const config = runtime.getSessionConfig(sessionId);
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
    clearCodeRestoreWarning(
      ctx.hasUI ? ctx.ui : runtime.sessionNotifiers.getOrUndefined(sessionId),
    );
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sessionId = ctx.sessionManager.getSessionId();
    await startCheckpointForLatestUser(sessionId, ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const stopReason = "stopReason" in event.message ? event.message.stopReason : undefined;
    if (!isAssistantStopReason(stopReason)) return;

    const sessionId = ctx.sessionManager.getSessionId();
    await runtime.sessionTasks.run(sessionId, async () => {
      const producer = runtime.producers.getOrUndefined(sessionId);
      if (!producer) return;
      producer.recordAssistantStopReason(stopReason);
    });
  });

  pi.on("turn_end", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await runtime.sessionTasks.run(sessionId, async () => {
      const producer = runtime.producers.getOrUndefined(sessionId);
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
    if (!runtime.startTreeNavigation(sessionId, targetId)) return;

    // Summarise or Summarize with custom prompt → behave like native /tree
    // (conversation-only navigation, no file restore).
    // When userWantsSummary is undefined (e.g. legacy pi-coding-agent),
    // treat it as "not explicitly requesting summary" so that restoreOnTree
    // settings can still apply.
    if (treeEvent.userWantsSummary === true) return;

    await finalizeCheckpointForSession(ctx, { force: true });
    await runtime.planTreeCodeRestore({
      sessionId,
      targetId,
      entries: ctx.sessionManager.getEntries(),
      hasUI: ctx.hasUI,
      ui: ctx.hasUI ? ctx.ui : undefined,
    });
  });

  pi.on("session_tree", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (runtime.treeRestores.consumeSuppressedTree(sessionId)) return;

    const restoreIntent = runtime.treeRestores.consumePending(sessionId);
    const restoreUi = runtime.treeRestores.consumeNotifier(
      sessionId,
      ctx.hasUI ? ctx.ui : undefined,
      runtime.sessionNotifiers.getOrUndefined(sessionId),
    );
    const config = runtime.getSessionConfig(sessionId);
    const treeRestoreMode = runtime.getSessionTreeRestoreMode(sessionId);
    if (restoreIntent?.mode === "Restore conversation") return;
    if (!restoreIntent && treeRestoreMode !== "always") return;

    const entries = ctx.sessionManager.getEntries();
    const checkpoints = mergeCheckpointEntries(
      entries,
      runtime.sessionCheckpointEntries.getOrUndefined(sessionId),
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
    if (!needsCodeSync(runtime.sessionSyncedCodeCommits.getOrUndefined(sessionId), targetCommit))
      return;

    const cwd = runtime.sessionCwds.getOrUndefined(sessionId) ?? ctx.cwd;
    const sessionFileForRestore =
      runtime.sessionFiles.getOrUndefined(sessionId) ?? ctx.sessionManager.getSessionFile();
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
      runtime.sessionSyncedCodeCommits.set(sessionId, targetCommit);
    }
  });

  registerCheckpointStorageCommand(pi);
  registerRewind(
    pi,
    async (sessionId) => {
      const config = runtime.getSessionConfig(sessionId);
      const sessionFileForRestore = runtime.sessionFiles.getOrUndefined(sessionId);
      const cwd = runtime.sessionCwds.getOrUndefined(sessionId);
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
      runtime.treeRestores.suppress(sessionId);
    },
    (sessionId) => {
      runtime.treeRestores.clearSuppression(sessionId);
    },
    (sessionId) => runtime.sessionSyncedCodeCommits.getOrUndefined(sessionId),
    (sessionId, commitHash) => {
      runtime.sessionSyncedCodeCommits.set(sessionId, commitHash);
    },
    async (ctx) => {
      await finalizeCheckpointForSession(ctx, { force: true });
    },
  );
}

import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { createCheckpointRef, parseDiffStats } from "@ayulab/pi-checkpoint";
import { errorMessage } from "@ayulab/runtime-core";

export interface FinalizedCheckpoint {
  readonly entry: CheckpointEntry;
  readonly skippedLargeFiles: readonly string[];
}

export type AutoCheckpointStartResult =
  | { readonly ok: true; readonly entries: readonly FinalizedCheckpoint[] }
  | { readonly ok: false; readonly message: string };

export type AutoCheckpointEndResult = { readonly ok: true } | { readonly ok: false };

export type AutoCheckpointFinalizeResult =
  | {
      readonly ok: true;
      readonly entry: CheckpointEntry;
      readonly skippedLargeFiles: readonly string[];
    }
  | { readonly ok: false };

export interface AutoCheckpointProducerOptions {
  readonly repo: RepoManager;
  readonly sessionId: string;
  readonly exclude: readonly string[];
  readonly createTurnId: () => string;
  readonly now: () => Date;
}

export interface AutoCheckpointTurnStartInput {
  readonly userEntryId: string;
  readonly prompt: string;
}

export interface AutoCheckpointTurnEndInput {
  readonly userEntryId: string;
  readonly prompt: string;
}

export class AutoCheckpointProducer {
  private pendingTurnId: string | undefined;

  private pendingUserEntryId: string | undefined;

  private pendingBeforeState: string | undefined;

  private pendingPrompt = "";

  constructor(private readonly options: AutoCheckpointProducerOptions) {}

  beginRun(): void {
    this.pendingTurnId = undefined;
    this.pendingUserEntryId = undefined;
    this.pendingBeforeState = undefined;
    this.pendingPrompt = "";
  }

  async turnStart(input: AutoCheckpointTurnStartInput): Promise<AutoCheckpointStartResult> {
    const entries: FinalizedCheckpoint[] = [];

    if (this.pendingBeforeState) {
      if (this.pendingUserEntryId === input.userEntryId) {
        return { ok: true, entries };
      }

      const finalized = await this.finalizeRun();
      if (finalized.ok) {
        entries.push({ entry: finalized.entry, skippedLargeFiles: finalized.skippedLargeFiles });
      }
    }

    this.pendingTurnId = this.options.createTurnId();
    this.pendingUserEntryId = input.userEntryId;
    this.pendingPrompt = input.prompt;

    try {
      await this.options.repo.withLock(async () => {
        await this.options.repo.ensureReady(this.options.exclude);
        this.pendingBeforeState = await this.options.repo.checkpoint(input.userEntryId);
        await this.options.repo.updateRef(
          createCheckpointRef(this.options.sessionId, input.userEntryId, "before"),
          this.pendingBeforeState,
        );
      });
      return { ok: true, entries };
    } catch (err) {
      this.beginRun();
      return { ok: false, message: `Checkpoint failed: ${errorMessage(err)}` };
    }
  }

  async turnEnd(input: AutoCheckpointTurnEndInput): Promise<AutoCheckpointEndResult> {
    if (!this.pendingTurnId || !this.pendingUserEntryId || !this.pendingBeforeState) {
      return { ok: false };
    }

    if (this.pendingUserEntryId === input.userEntryId) {
      this.pendingPrompt = input.prompt;
    }
    return { ok: true };
  }

  async finalizeRun(): Promise<AutoCheckpointFinalizeResult> {
    if (!this.pendingTurnId || !this.pendingUserEntryId || !this.pendingBeforeState) {
      return { ok: false };
    }

    try {
      const turnId = this.pendingTurnId;
      const userEntryId = this.pendingUserEntryId;
      const beforeState = this.pendingBeforeState;
      const prompt = this.pendingPrompt;
      const result = await this.options.repo.withLock(
        async (): Promise<{
          readonly entry: CheckpointEntry;
          readonly skippedLargeFiles: readonly string[];
        }> => {
          await this.options.repo.stageAll();
          const stdout = await this.options.repo.diffAgainst(beforeState);
          const parsed = parseDiffStats(stdout);
          const afterState =
            parsed.length > 0 ? await this.options.repo.checkpoint(userEntryId) : beforeState;
          await this.options.repo.updateRef(
            createCheckpointRef(this.options.sessionId, userEntryId, "after"),
            afterState,
          );

          return {
            entry: {
              v: 2,
              kind: "checkpoint",
              turnId,
              userEntryId,
              beforeState,
              afterState,
              prompt,
              fileCount: parsed.length,
              fileChanges: parsed,
              createdAt: this.options.now().toISOString(),
            },
            skippedLargeFiles: this.options.repo.getSkippedLargeFiles(),
          };
        },
      );

      return { ok: true, entry: result.entry, skippedLargeFiles: result.skippedLargeFiles };
    } catch {
      return { ok: false };
    } finally {
      this.beginRun();
    }
  }
}

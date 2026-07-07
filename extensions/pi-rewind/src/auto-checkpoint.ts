import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { parseDiffStats } from "@ayulab/pi-checkpoint";
import { errorMessage } from "@ayulab/runtime-core";

export type AutoCheckpointStartResult =
  | { readonly ok: true; readonly entries: readonly CheckpointEntry[] }
  | { readonly ok: false; readonly message: string };

export type AutoCheckpointEndResult = { readonly ok: true } | { readonly ok: false };

export type AutoCheckpointFinalizeResult =
  | { readonly ok: true; readonly entry: CheckpointEntry }
  | { readonly ok: false; readonly message?: string };

export interface AutoCheckpointProducerOptions {
  readonly repo: RepoManager;
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

  private pendingBeforeCommit: string | undefined;

  private pendingPrompt = "";

  constructor(private readonly options: AutoCheckpointProducerOptions) {}

  beginRun(): void {
    this.pendingTurnId = undefined;
    this.pendingUserEntryId = undefined;
    this.pendingBeforeCommit = undefined;
    this.pendingPrompt = "";
  }

  async turnStart(input: AutoCheckpointTurnStartInput): Promise<AutoCheckpointStartResult> {
    const entries: CheckpointEntry[] = [];

    if (this.pendingBeforeCommit) {
      if (this.pendingUserEntryId === input.userEntryId) {
        return { ok: true, entries };
      }

      const finalized = await this.finalizeRun();
      if (finalized.ok) entries.push(finalized.entry);
    }

    this.pendingTurnId = this.options.createTurnId();
    this.pendingUserEntryId = input.userEntryId;
    this.pendingPrompt = input.prompt;

    try {
      await this.options.repo.withLock(async () => {
        await this.options.repo.ensureReady(this.options.exclude);
        this.pendingBeforeCommit = await this.options.repo.checkpoint(input.userEntryId);
      });
      return { ok: true, entries };
    } catch (err) {
      this.beginRun();
      return { ok: false, message: `Checkpoint failed: ${errorMessage(err)}` };
    }
  }

  async turnEnd(input: AutoCheckpointTurnEndInput): Promise<AutoCheckpointEndResult> {
    if (!this.pendingTurnId || !this.pendingUserEntryId || !this.pendingBeforeCommit) {
      return { ok: false };
    }

    if (this.pendingUserEntryId === input.userEntryId) {
      this.pendingPrompt = input.prompt;
    }
    return { ok: true };
  }

  async finalizeRun(): Promise<AutoCheckpointFinalizeResult> {
    if (!this.pendingTurnId || !this.pendingUserEntryId || !this.pendingBeforeCommit) {
      return { ok: false };
    }

    try {
      const turnId = this.pendingTurnId;
      const userEntryId = this.pendingUserEntryId;
      const beforeCommit = this.pendingBeforeCommit;
      const prompt = this.pendingPrompt;
      const entry = await this.options.repo.withLock(async (): Promise<CheckpointEntry> => {
        await this.options.repo.stageAll();
        const stdout = await this.options.repo.diffAgainst(beforeCommit);
        const parsed = parseDiffStats(stdout);
        const afterCommit =
          parsed.length > 0 ? await this.options.repo.checkpoint(userEntryId) : beforeCommit;

        return {
          v: 2,
          kind: "checkpoint",
          turnId,
          userEntryId,
          beforeCommit,
          afterCommit,
          prompt,
          fileCount: parsed.length,
          fileChanges: parsed,
          createdAt: this.options.now().toISOString(),
        };
      });

      return { ok: true, entry };
    } catch (err) {
      return { ok: false, message: `Checkpoint finalization failed: ${errorMessage(err)}` };
    } finally {
      this.beginRun();
    }
  }
}

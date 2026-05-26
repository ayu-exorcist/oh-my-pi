import type { CheckpointEntry, RepoManager } from "@ayulab/pi-checkpoint";
import { errorMessage, parseDiffStats } from "@ayulab/pi-checkpoint";

export type AutoCheckpointStartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type AutoCheckpointEndResult =
  | { readonly ok: true; readonly entry: CheckpointEntry }
  | { readonly ok: false };

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

export class AutoCheckpointProducer {
  private pendingTurnId: string | undefined;

  private pendingUserEntryId: string | undefined;

  private pendingBeforeCommit: string | undefined;

  private pendingPrompt = "";

  constructor(private readonly options: AutoCheckpointProducerOptions) {}

  async turnStart(input: AutoCheckpointTurnStartInput): Promise<AutoCheckpointStartResult> {
    this.pendingTurnId = this.options.createTurnId();
    this.pendingUserEntryId = input.userEntryId;
    this.pendingPrompt = input.prompt;

    try {
      await this.options.repo.ensureReady(this.options.exclude);
      this.pendingBeforeCommit = await this.options.repo.checkpoint(input.userEntryId);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: `Checkpoint failed: ${errorMessage(err)}` };
    }
  }

  async turnEnd(): Promise<AutoCheckpointEndResult> {
    if (!this.pendingTurnId || !this.pendingUserEntryId || !this.pendingBeforeCommit) {
      return { ok: false };
    }

    try {
      await this.options.repo.stageAll();
      const stdout = await this.options.repo.diffAgainst(this.pendingBeforeCommit);
      const parsed = parseDiffStats(stdout);
      const afterCommit =
        parsed.length > 0
          ? await this.options.repo.checkpoint(this.pendingUserEntryId)
          : this.pendingBeforeCommit;

      return {
        ok: true,
        entry: {
          v: 2,
          kind: "checkpoint",
          turnId: this.pendingTurnId,
          userEntryId: this.pendingUserEntryId,
          beforeCommit: this.pendingBeforeCommit,
          afterCommit,
          prompt: this.pendingPrompt,
          fileCount: parsed.length,
          fileChanges: parsed,
          createdAt: this.options.now().toISOString(),
        },
      };
    } catch {
      return { ok: false };
    } finally {
      this.pendingTurnId = undefined;
      this.pendingUserEntryId = undefined;
      this.pendingBeforeCommit = undefined;
      this.pendingPrompt = "";
    }
  }
}

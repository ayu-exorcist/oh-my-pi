import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  Text,
  TruncatedText,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { getCheckpointEntries } from "@ayulab/pi-checkpoint";
import type { RepoManager, CheckpointEntry, FileChange } from "@ayulab/pi-checkpoint";
import { hasItems } from "@ayulab/runtime-core";
import { getBranchCheckpointEntries } from "../utils/branch-checkpoints";
import { runRestoreMode } from "./restore-mode";

async function findCleanDirtyBaseCommit(
  repo: RepoManager,
  checkpoints: readonly CheckpointEntry[],
  fallbackCommit: string,
): Promise<string> {
  const commits = new Set<string>();
  for (const cp of [...checkpoints].reverse()) {
    commits.add(cp.afterCommit);
    commits.add(cp.beforeCommit);
  }

  try {
    return await repo.withLock(async () => {
      await repo.stageAll();
      for (const commit of commits) {
        const diff = await repo.diffAgainst(commit);
        if (diff.trim().length === 0) return commit;
      }
      return fallbackCommit;
    });
  } catch {
    return fallbackCommit;
  }
}

export function findConversationEntryIdForCheckpoint(
  _branch: readonly unknown[],
  userEntryId: string,
): string {
  return userEntryId;
}

/** Render a single file change with ANSI colour codes for terminal display. */
export function formatChangeLine(change: FileChange): string {
  return `\x1b[38;5;245m${change.path} \x1b[38;5;2m+${change.added}\x1b[38;5;245m \x1b[38;5;1m-${change.removed}\x1b[0m`;
}

/**
 * Build a multi-line display string for a checkpoint entry.
 *
 * Includes the prompt and per-file change stats so that the user can
 * see exactly what happened during that turn. Blank lines deliberately
 * add vertical breathing room in Pi's select dialog.
 */
export function buildCheckpointItem(cp: CheckpointEntry): string {
  const header = cp.prompt;
  if (cp.fileCount === 0) {
    return `${header}\n   \x1b[38;5;245mNo code changes\x1b[0m\n`;
  }
  if (cp.fileChanges.length === 0) {
    return `${header}\n   \x1b[38;5;245m${cp.fileCount} file${cp.fileCount > 1 ? "s" : ""} changed\x1b[0m\n`;
  }

  if (cp.fileChanges.length === 1) {
    const change = cp.fileChanges[0];
    return `${header}\n   ${change ? formatChangeLine(change) : ""}\n`;
  }

  const totalAdded = cp.fileChanges.reduce((sum, change) => sum + change.added, 0);
  const totalRemoved = cp.fileChanges.reduce((sum, change) => sum + change.removed, 0);
  return `${header}\n   \x1b[38;5;245m${cp.fileCount} files changed  \x1b[38;5;2m+${totalAdded}\x1b[38;5;245m \x1b[38;5;1m-${totalRemoved}\x1b[0m\n`;
}

function checkpointChangedFiles(checkpoint: CheckpointEntry): boolean {
  return checkpoint.fileCount > 0 || checkpoint.fileChanges.length > 0;
}

function rewindRangeHasFileChanges(
  checkpoints: readonly CheckpointEntry[],
  selectedIndex: number,
): boolean {
  if (selectedIndex < 0 || selectedIndex >= checkpoints.length) return false;
  return checkpoints.slice(selectedIndex).some(checkpointChangedFiles);
}

function getMaxVisibleCheckpointLines(terminalRows: number): number {
  return Math.max(5, Math.floor(terminalRows / 2));
}

class CheckpointList implements Component {
  private selectedIndex: number;

  public onSelect?: (index: number, item: string) => void;
  public onCancel?: () => void;

  public constructor(
    private readonly items: readonly string[],
    private readonly maxVisibleLines: number,
    private readonly style: {
      readonly accent: (text: string) => string;
      readonly selectedBg: (text: string) => string;
      readonly selectedCursor: (text: string) => string;
      readonly selectedText: (text: string) => string;
      readonly muted: (text: string) => string;
    },
    initialSelectedIndex?: number,
  ) {
    this.selectedIndex =
      initialSelectedIndex !== undefined &&
      initialSelectedIndex >= 0 &&
      initialSelectedIndex < items.length
        ? initialSelectedIndex
        : Math.max(0, items.length - 1);
  }

  public invalidate(): void {
    // No cached render state.
  }

  public render(width: number): string[] {
    if (this.items.length === 0) return [this.style.muted("  No checkpoints available")];

    const itemLinesByIndex = this.items.map((item) => this.getDisplayLines(item));
    const { startIndex, endIndex } = this.getVisibleRange(itemLinesByIndex);
    const lines: string[] = [];

    for (let index = startIndex; index < endIndex; index++) {
      /* c8 ignore next */
      const itemLines = itemLinesByIndex[index] ?? [];
      const isSelected = index === this.selectedIndex;
      const renderedItemLines = itemLines.map((line, lineIndex) =>
        this.renderItemLine(line, lineIndex, isSelected, width),
      );
      const selectedItemWidth = isSelected
        ? renderedItemLines.reduce((maxWidth, line) => Math.max(maxWidth, visibleWidth(line)), 0)
        : 0;

      for (const line of renderedItemLines) {
        lines.push(
          isSelected ? applyBlockBackground(line, selectedItemWidth, this.style.selectedBg) : line,
        );
      }
    }

    lines.push(
      truncateToWidth(
        this.style.muted(`  (${this.selectedIndex + 1}/${this.items.length})`),
        width,
      ),
    );
    return lines;
  }

  private renderItemLine(
    line: string,
    lineIndex: number,
    isSelected: boolean,
    width: number,
  ): string {
    const cursor = isSelected ? this.style.selectedCursor("› ") : "  ";
    const prefix = lineIndex === 0 ? cursor : "  ";
    const displayLine =
      lineIndex === 0 && line === "(current)"
        ? this.style.accent(line)
        : lineIndex === 0
          ? this.formatUserLine(line)
          : line;
    const content =
      prefix + (isSelected && lineIndex === 0 ? this.style.selectedText(displayLine) : displayLine);
    return truncateToWidth(content, width);
  }

  private formatUserLine(line: string): string {
    return `${this.style.accent("• user: ")}${line}`;
  }

  private getDisplayLines(item: string): readonly string[] {
    const lines = item
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return [""];
    if (lines[0] === "(current)") return lines;

    const firstDetailIndex = lines.findIndex((line) => line.startsWith("   "));
    const nameLines = firstDetailIndex >= 0 ? lines.slice(0, firstDetailIndex) : lines;
    const detailLines = firstDetailIndex >= 0 ? lines.slice(firstDetailIndex) : [];
    return [nameLines.join(" ").replace(/[\t]+/g, " ").trim(), ...detailLines];
  }

  private getVisibleRange(itemLinesByIndex: readonly (readonly string[])[]): {
    readonly startIndex: number;
    readonly endIndex: number;
  } {
    const lineLimit = Math.max(1, this.maxVisibleLines);
    let startIndex = this.selectedIndex;
    let endIndex = this.selectedIndex + 1;
    /* c8 ignore next */
    let visibleLines = itemLinesByIndex[this.selectedIndex]?.length ?? 1;
    const targetLinesBeforeSelection = Math.floor(Math.max(0, lineLimit - visibleLines) / 2);
    let linesBeforeSelection = 0;

    while (startIndex > 0) {
      /* c8 ignore next */
      const previousLineCount = itemLinesByIndex[startIndex - 1]?.length ?? 1;
      if (linesBeforeSelection + previousLineCount > targetLinesBeforeSelection) break;
      startIndex--;
      linesBeforeSelection += previousLineCount;
      visibleLines += previousLineCount;
    }

    while (endIndex < itemLinesByIndex.length) {
      /* c8 ignore next */
      const nextLineCount = itemLinesByIndex[endIndex]?.length ?? 1;
      if (visibleLines + nextLineCount > lineLimit) break;
      endIndex++;
      visibleLines += nextLineCount;
    }

    while (startIndex > 0) {
      /* c8 ignore next */
      const previousLineCount = itemLinesByIndex[startIndex - 1]?.length ?? 1;
      if (visibleLines + previousLineCount > lineLimit) break;
      startIndex--;
      visibleLines += previousLineCount;
    }

    return { startIndex, endIndex };
  }

  public handleInput(keyData: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(keyData, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0 ? this.items.length - 1 : this.selectedIndex - 1;
    } else if (keybindings.matches(keyData, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.items.length - 1 ? 0 : this.selectedIndex + 1;
    } else if (keybindings.matches(keyData, "tui.select.confirm")) {
      const selected = this.items[this.selectedIndex];
      if (selected !== undefined) this.onSelect?.(this.selectedIndex, selected);
    } else if (keybindings.matches(keyData, "tui.select.cancel")) {
      this.onCancel?.();
    }
  }
}

function formatKeyText(keys: readonly string[]): string {
  return keys.join("/");
}

type SelectKeybinding =
  | "tui.select.up"
  | "tui.select.down"
  | "tui.select.confirm"
  | "tui.select.cancel";

function keyText(
  keybindings: { getKeys: (keybinding: SelectKeybinding) => readonly string[] },
  keybinding: SelectKeybinding,
): string {
  return formatKeyText(keybindings.getKeys(keybinding));
}

function renderBorder(width: number, color: (text: string) => string): string {
  return color("─".repeat(Math.max(1, width)));
}

const trailingSgrPattern = new RegExp(String.raw`(?:\u001b\[[0-9;]*m)+$`, "g");
const sgrPattern = new RegExp(String.raw`\u001b\[([0-9;]*)m`, "g");

function applyBlockBackground(
  line: string,
  blockWidth: number,
  background: (text: string) => string,
): string {
  const lineWithoutTrailingSgr = line.replace(trailingSgrPattern, "");
  const paddedLine =
    lineWithoutTrailingSgr +
    " ".repeat(Math.max(0, blockWidth - visibleWidth(lineWithoutTrailingSgr)));
  const marker = "\uE000";
  const wrappedMarker = background(marker);
  const markerIndex = wrappedMarker.indexOf(marker);
  const open = markerIndex >= 0 ? wrappedMarker.slice(0, markerIndex) : "";
  const close = markerIndex >= 0 ? wrappedMarker.slice(markerIndex + marker.length) : "";

  if (visibleWidth(open + close) > 0) return background(paddedLine);

  return open + restoreBackgroundAfterReset(paddedLine, open) + close;
}

function restoreBackgroundAfterReset(line: string, openBackground: string): string {
  return line.replace(sgrPattern, (sequence: string, params: string) => {
    const codes = params.length === 0 ? [0] : params.split(";").map((part) => Number(part));
    return codes.includes(0) || codes.includes(49) ? sequence + openBackground : sequence;
  });
}

export async function selectCheckpointItem(
  ctx: Pick<ExtensionCommandContext, "ui">,
  items: readonly string[],
  initialSelectedItem?: string,
): Promise<string | undefined> {
  if (!ctx.ui.custom) return ctx.ui.select("Rewind to checkpoint:", [...items]);

  const initialIndex = initialSelectedItem ? items.indexOf(initialSelectedItem) : -1;
  const initialSelectedIndex = initialIndex >= 0 ? initialIndex : undefined;

  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    const maxVisibleLines = getMaxVisibleCheckpointLines(tui.terminal.rows);
    const checkpointList = new CheckpointList(
      items,
      maxVisibleLines,
      {
        accent: (text) => theme.fg("accent", text),
        selectedBg: (text) => theme.bg("selectedBg", text),
        selectedCursor: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.bold(text),
        muted: (text) => theme.fg("muted", text),
      },
      initialSelectedIndex,
    );
    checkpointList.onSelect = (_index, item) => done(item);
    checkpointList.onCancel = () => done(undefined);

    const title = new Text(theme.bold("  Rewind Checkpoints"), 1, 0);
    const hint = new TruncatedText(
      theme.fg(
        "muted",
        `  ${keyText(keybindings, "tui.select.up")}/${keyText(keybindings, "tui.select.down")}: move. ${keyText(keybindings, "tui.select.confirm")}: select. ${keyText(keybindings, "tui.select.cancel")}: cancel`,
      ),
      0,
      0,
    );

    return {
      render(width: number) {
        return [
          renderBorder(width, (text) => theme.fg("border", text)),
          ...title.render(width),
          ...hint.render(width),
          renderBorder(width, (text) => theme.fg("border", text)),
          "",
          ...checkpointList.render(width),
          "",
          renderBorder(width, (text) => theme.fg("border", text)),
        ];
      },
      handleInput(data: string) {
        checkpointList.handleInput(data);
      },
      invalidate() {
        title.invalidate();
        checkpointList.invalidate();
        hint.invalidate();
      },
    } satisfies Component;
  });
}

function buildFallbackIndexedItems(items: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  return items.map((item, index) => (counts.get(item) === 1 ? item : `#${index + 1} ${item}`));
}

export async function selectCheckpointIndex(
  ctx: Pick<ExtensionCommandContext, "ui">,
  items: readonly string[],
  initialSelectedIndex?: number,
): Promise<number | undefined> {
  if (!ctx.ui.custom) {
    const indexedItems = buildFallbackIndexedItems(items);
    const selected = await ctx.ui.select("Rewind to checkpoint:", [...indexedItems]);
    if (!selected) return undefined;
    const selectedIndex = indexedItems.indexOf(selected);
    return selectedIndex >= 0 ? selectedIndex : undefined;
  }

  return ctx.ui.custom<number | undefined>((tui, theme, keybindings, done) => {
    const maxVisibleLines = getMaxVisibleCheckpointLines(tui.terminal.rows);
    const checkpointList = new CheckpointList(
      items,
      maxVisibleLines,
      {
        accent: (text) => theme.fg("accent", text),
        selectedBg: (text) => theme.bg("selectedBg", text),
        selectedCursor: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.bold(text),
        muted: (text) => theme.fg("muted", text),
      },
      initialSelectedIndex,
    );
    checkpointList.onSelect = (index) => done(index);
    checkpointList.onCancel = () => done(undefined);

    const title = new Text(theme.bold("  Rewind Checkpoints"), 1, 0);
    const hint = new TruncatedText(
      theme.fg(
        "muted",
        `  ${keyText(keybindings, "tui.select.up")}/${keyText(keybindings, "tui.select.down")}: move. ${keyText(keybindings, "tui.select.confirm")}: select. ${keyText(keybindings, "tui.select.cancel")}: cancel`,
      ),
      0,
      0,
    );

    return {
      render(width: number) {
        return [
          renderBorder(width, (text) => theme.fg("border", text)),
          ...title.render(width),
          ...hint.render(width),
          renderBorder(width, (text) => theme.fg("border", text)),
          "",
          ...checkpointList.render(width),
          "",
          renderBorder(width, (text) => theme.fg("border", text)),
        ];
      },
      handleInput(data: string) {
        checkpointList.handleInput(data);
      },
      invalidate() {
        title.invalidate();
        checkpointList.invalidate();
        hint.invalidate();
      },
    } satisfies Component;
  });
}

type ResolveRewindRepoResult =
  | { readonly ok: true; readonly repo: RepoManager }
  | { readonly ok: false; readonly message: string; readonly level: "warning" | "error" };

type ResolveRewindRepo = (
  sessionId: string,
) =>
  | RepoManager
  | undefined
  | ResolveRewindRepoResult
  | Promise<RepoManager | undefined | ResolveRewindRepoResult>;

function isResolveRewindRepoResult(value: unknown): value is ResolveRewindRepoResult {
  return typeof value === "object" && value !== null && "ok" in value;
}

async function resolveRewindRepo(
  resolveRepo: ResolveRewindRepo,
  sessionId: string,
): Promise<ResolveRewindRepoResult> {
  const resolved = await resolveRepo(sessionId);
  if (isResolveRewindRepoResult(resolved)) return resolved;
  if (resolved) return { ok: true, repo: resolved };
  return {
    ok: false,
    message:
      "Files were not restored because checkpoint storage for this session is missing. Conversation restore is still available.",
    level: "warning",
  };
}

/**
 * Register the `/rewind` command.
 *
 * Presents an interactive list of checkpoints. When the active checkpoint
 * list contains file changes, it supports three options:
 *   1. Restore code and conversation
 *   2. Restore conversation
 *   3. Restore code
 *
 * If the checkpoint list has no file changes, code restore options are hidden.
 *
 * Dirty-guard: if the workspace has unsnapshotted changes, warns the user
 * before checking out an old commit. A safety commit is created before
 * checkout so that failures can be rolled back automatically.
 */
export function registerRewind(
  pi: ExtensionAPI,
  resolveRepo: ResolveRewindRepo,
  suppressTreeRestore: (sessionId: string) => void = () => undefined,
  clearTreeRestoreSuppression: (sessionId: string) => void = () => undefined,
  getSyncedCodeCommit: (sessionId: string) => string | undefined = () => undefined,
  setSyncedCodeCommit: (sessionId: string, commitHash: string) => void = () => undefined,
  flushPendingCheckpoint: (ctx: ExtensionCommandContext) => Promise<void> = async () => undefined,
) {
  pi.registerCommand("rewind", {
    description: "Rewind files to a previous checkpoint",
    handler: async (_args, ctx) => {
      await flushPendingCheckpoint(ctx);

      const entries = ctx.sessionManager.getEntries();
      const branch = ctx.sessionManager.getBranch();
      const cps = getBranchCheckpointEntries(entries, branch);
      if (!hasItems(cps)) {
        ctx.ui.notify("No checkpoints available", "warning");
        return;
      }

      const currentItem = "(current)\n";
      const items = [...cps.map((cp) => buildCheckpointItem(cp)), currentItem];
      const sessionId = ctx.sessionManager.getSessionId();

      let selectedIndex: number | undefined;
      let targetCp: CheckpointEntry | undefined;
      let mode: string | undefined;

      while (!mode) {
        selectedIndex = await selectCheckpointIndex(ctx, items, selectedIndex);
        if (selectedIndex === undefined) return;

        targetCp = cps[selectedIndex];
        if (!targetCp) return;

        const hasFileChanges = rewindRangeHasFileChanges(cps, selectedIndex);
        const codeRestoreWouldChangeState =
          targetCp.beforeCommit !== getSyncedCodeCommit(sessionId);
        const modes =
          hasFileChanges && codeRestoreWouldChangeState
            ? ["Restore code and conversation", "Restore conversation", "Restore code"]
            : ["Restore conversation"];

        mode = await ctx.ui.select("Restore mode:", modes);
      }

      /* c8 ignore next */
      if (!targetCp) return;

      const latest = cps.at(-1);
      /* c8 ignore next */
      if (!latest) return;

      const restoresCode = mode === "Restore code" || mode === "Restore code and conversation";
      const repoResult = restoresCode
        ? await resolveRewindRepo(resolveRepo, ctx.sessionManager.getSessionId())
        : undefined;
      if (repoResult && !repoResult.ok) {
        ctx.ui.notify(repoResult.message, repoResult.level);
        return;
      }
      const repo = repoResult?.repo;
      const dirtyBaseCommit = repo
        ? await findCleanDirtyBaseCommit(repo, getCheckpointEntries(entries), latest.afterCommit)
        : latest.afterCommit;

      await runRestoreMode({
        mode,
        ...(repo ? { repo } : {}),
        ui: ctx.ui,
        navigateTree: async (entryId, options) => {
          suppressTreeRestore(sessionId);
          try {
            return await ctx.navigateTree(entryId, options);
          } finally {
            clearTreeRestoreSuppression(sessionId);
          }
        },
        targetCp,
        latestCp: latest,
        conversationEntryId: findConversationEntryIdForCheckpoint(branch, targetCp.userEntryId),
        dirtyBaseCommit,
        onCodeRestore: (commitHash) => setSyncedCodeCommit(sessionId, commitHash),
      });
    },
  });
}

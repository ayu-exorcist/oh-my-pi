import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "@ayulab/runtime-core";
import {
  Input,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from "@earendil-works/pi-tui";

export type SessionListProgress = (loaded: number, total: number) => void;
export type CheckpointStatus = "no checkpoints" | "no session";
export type CheckpointScope = "current" | "all";
export type CheckpointSortMode = "threaded" | "recent" | "relevance";
export type CheckpointNameFilter = "all" | "named";

export interface CheckpointSelectorSession extends SessionInfo {
  readonly checkpointRepoDir: string | undefined;
  readonly sourceSessionFile: string | undefined;
  readonly checkpointStatus?: CheckpointStatus;
}

export interface CheckpointSelectorTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
}

export interface CheckpointSelectorKeybindings {
  getKeys(keybinding: string): readonly string[];
  matches(keyData: string, keybinding: string): boolean;
}

export interface CheckpointSelectorOptions {
  readonly currentLoader: (
    onProgress?: SessionListProgress,
  ) => Promise<CheckpointSelectorSession[]>;
  readonly allLoader: (onProgress?: SessionListProgress) => Promise<CheckpointSelectorSession[]>;
  readonly deleteStorage: (
    session: CheckpointSelectorSession,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly currentSessionPath?: string;
  readonly requestRender: () => void;
  readonly onClose: () => void;
  readonly theme: CheckpointSelectorTheme;
  readonly keybindings: CheckpointSelectorKeybindings;
}

interface SessionTreeNode {
  readonly session: CheckpointSelectorSession;
  readonly children: SessionTreeNode[];
}

interface FlattenedSessionNode {
  readonly session: CheckpointSelectorSession;
  readonly depth: number;
  readonly isLast: boolean;
  readonly ancestorContinues: readonly boolean[];
}

interface ParsedSearchToken {
  readonly kind: "fuzzy" | "phrase";
  readonly value: string;
}

interface ParsedSearchQuery {
  readonly mode: "tokens" | "regex";
  readonly tokens: readonly ParsedSearchToken[];
  readonly regex: RegExp | null;
  readonly error?: string;
}

interface StatusMessage {
  readonly type: "info" | "error";
  readonly message: string;
}

function normalizeComparablePath(inputPath: string | undefined): string | undefined {
  if (!inputPath) return undefined;
  const resolved = inputPath.replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function normalizeTitle(input: string | undefined): string {
  const collapsed = input?.replace(/\s+/g, " ").trim() ?? "";
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripControlCharacters(input: string): string {
  return Array.from(input, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : char;
  }).join("");
}

function hasSessionName(session: CheckpointSelectorSession): boolean {
  return Boolean(session.name?.trim());
}

function getSessionSearchText(session: CheckpointSelectorSession): string {
  return `${session.id} ${session.name ?? ""} ${session.firstMessage} ${session.allMessagesText} ${session.cwd}`;
}

function shortenPathForDisplay(inputPath: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (!home) return inputPath;
  const normalizedHome = home.replace(/\\/g, "/");
  const normalizedPath = inputPath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(normalizedHome)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return inputPath;
}

function formatSessionAge(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

function parseSearchQuery(query: string): ParsedSearchQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { mode: "tokens", tokens: [], regex: null };
  }

  if (trimmed.startsWith("re:")) {
    const pattern = trimmed.slice(3).trim();
    if (!pattern) {
      return { mode: "regex", tokens: [], regex: null, error: "Empty regex" };
    }
    try {
      return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") };
    } catch (error) {
      return {
        mode: "regex",
        tokens: [],
        regex: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const tokens: ParsedSearchToken[] = [];
  let buffer = "";
  let inQuote = false;

  const flush = (kind: ParsedSearchToken["kind"]): void => {
    const value = buffer.trim();
    buffer = "";
    if (!value) return;
    tokens.push({ kind, value });
  };

  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index]!;
    if (char === '"') {
      if (inQuote) {
        flush("phrase");
        inQuote = false;
      } else {
        flush("fuzzy");
        inQuote = true;
      }
      continue;
    }
    if (!inQuote && /\s/.test(char)) {
      flush("fuzzy");
      continue;
    }
    buffer += char;
  }

  if (inQuote) {
    return {
      mode: "tokens",
      tokens: trimmed
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => ({ kind: "fuzzy" as const, value })),
      regex: null,
    };
  }

  flush("fuzzy");
  return { mode: "tokens", tokens, regex: null };
}

function fuzzyScore(
  pattern: string,
  text: string,
): { readonly matches: boolean; readonly score: number } {
  const needle = pattern.toLowerCase();
  const haystack = text.toLowerCase();
  let index = -1;
  let score = 0;

  for (const char of needle) {
    index = haystack.indexOf(char, index + 1);
    if (index < 0) return { matches: false, score: 0 };
    score += index;
  }

  return { matches: true, score };
}

function matchSession(
  session: CheckpointSelectorSession,
  parsed: ParsedSearchQuery,
): { readonly matches: boolean; readonly score: number } {
  const text = getSessionSearchText(session);
  if (parsed.mode === "regex") {
    if (!parsed.regex) return { matches: false, score: 0 };
    const index = text.search(parsed.regex);
    return index < 0 ? { matches: false, score: 0 } : { matches: true, score: index * 0.1 };
  }

  if (parsed.tokens.length === 0) {
    return { matches: true, score: 0 };
  }

  let totalScore = 0;
  let normalizedText: string | null = null;

  for (const token of parsed.tokens) {
    if (token.kind === "phrase") {
      normalizedText ??= normalizeWhitespaceLower(text);
      const phrase = normalizeWhitespaceLower(token.value);
      const index = normalizedText.indexOf(phrase);
      if (index < 0) return { matches: false, score: 0 };
      totalScore += index * 0.1;
      continue;
    }

    const fuzzy = fuzzyScore(token.value, text);
    if (!fuzzy.matches) return { matches: false, score: 0 };
    totalScore += fuzzy.score;
  }

  return { matches: true, score: totalScore };
}

function buildSessionTree(sessions: readonly CheckpointSelectorSession[]): SessionTreeNode[] {
  const byPath = new Map<string, SessionTreeNode>();
  for (const session of sessions) {
    const sessionPath = normalizeComparablePath(session.path) ?? session.path;
    byPath.set(sessionPath, { session, children: [] });
  }

  const roots: SessionTreeNode[] = [];
  for (const session of sessions) {
    const sessionPath = normalizeComparablePath(session.path) ?? session.path;
    const node = byPath.get(sessionPath);
    if (!node) continue;

    const parentPath = normalizeComparablePath(session.parentSessionPath);
    if (parentPath && byPath.has(parentPath)) {
      byPath.get(parentPath)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: SessionTreeNode[]): void => {
    nodes.sort((left, right) => right.session.modified.getTime() - left.session.modified.getTime());
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return roots;
}

function flattenSessionTree(roots: readonly SessionTreeNode[]): FlattenedSessionNode[] {
  const result: FlattenedSessionNode[] = [];

  const walk = (
    node: SessionTreeNode,
    depth: number,
    ancestorContinues: readonly boolean[],
    isLast: boolean,
  ): void => {
    result.push({ session: node.session, depth, isLast, ancestorContinues });
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!;
      const childIsLast = index === node.children.length - 1;
      const continues = depth > 0 ? !isLast : false;
      walk(child, depth + 1, [...ancestorContinues, continues], childIsLast);
    }
  };

  for (let index = 0; index < roots.length; index++) {
    walk(roots[index]!, 0, [], index === roots.length - 1);
  }

  return result;
}

function filterAndSortSessions(
  sessions: readonly CheckpointSelectorSession[],
  query: string,
  sortMode: CheckpointSortMode,
  nameFilter: CheckpointNameFilter,
): readonly CheckpointSelectorSession[] {
  const nameFiltered =
    nameFilter === "all" ? sessions : sessions.filter((session) => hasSessionName(session));
  const trimmed = query.trim();
  if (!trimmed) return nameFiltered;

  const parsed = parseSearchQuery(query);
  if (parsed.error) return [];

  if (sortMode === "recent") {
    return nameFiltered.filter((session) => matchSession(session, parsed).matches);
  }

  const scored = nameFiltered
    .map((session) => ({ session, score: matchSession(session, parsed) }))
    .filter((entry) => entry.score.matches);

  scored.sort((left, right) => {
    if (left.score.score !== right.score.score) {
      return left.score.score - right.score.score;
    }
    return right.session.modified.getTime() - left.session.modified.getTime();
  });

  return scored.map((entry) => entry.session);
}

export const __checkpointSelectorTestOnly = {
  buildSessionTree,
  filterAndSortSessions,
  flattenSessionTree,
  matchSession,
  normalizeComparablePath,
  normalizeTitle,
  parseSearchQuery,
  shortenPathForDisplay,
  stripControlCharacters,
};

class CheckpointSelectorHeader {
  private loading = false;
  private loadProgress: { readonly loaded: number; readonly total: number } | null = null;
  private statusMessage: StatusMessage | null = null;
  private statusTimeout: ReturnType<typeof setTimeout> | null = null;
  private confirmingDelete: CheckpointStatus | "storage" | false = false;

  constructor(
    private scope: CheckpointScope,
    private sortMode: CheckpointSortMode,
    private nameFilter: CheckpointNameFilter,
    private showPath: boolean,
    private readonly requestRender: () => void,
    private readonly keybindings: CheckpointSelectorKeybindings,
    private readonly theme: CheckpointSelectorTheme,
  ) {}

  setScope(scope: CheckpointScope): void {
    this.scope = scope;
  }

  setSortMode(sortMode: CheckpointSortMode): void {
    this.sortMode = sortMode;
  }

  setNameFilter(nameFilter: CheckpointNameFilter): void {
    this.nameFilter = nameFilter;
  }

  setShowPath(showPath: boolean): void {
    this.showPath = showPath;
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    this.loadProgress = null;
  }

  setProgress(loaded: number, total: number): void {
    this.loadProgress = { loaded, total };
  }

  setConfirmingDelete(confirmingDelete: CheckpointStatus | "storage" | false): void {
    this.confirmingDelete = confirmingDelete;
  }

  setStatusMessage(message: StatusMessage | null, autoHideMs?: number): void {
    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
      this.statusTimeout = null;
    }
    this.statusMessage = message;
    if (!message || !autoHideMs) return;

    this.statusTimeout = setTimeout(() => {
      this.statusMessage = null;
      this.statusTimeout = null;
      this.requestRender();
    }, autoHideMs);
  }

  render(width: number): string[] {
    const title = this.scope === "current" ? "Checkpoint (Current Folder)" : "Checkpoint (All)";
    const leftText = this.theme.bold(title);
    const sortLabel =
      this.sortMode === "threaded" ? "Threaded" : this.sortMode === "recent" ? "Recent" : "Fuzzy";
    const nameLabel = this.nameFilter === "all" ? "All" : "Named";

    const scopeText = this.loading
      ? `${this.theme.fg("muted", "○ Current Folder | ")}${this.theme.fg(
          "accent",
          this.loadProgress
            ? `Loading ${this.loadProgress.loaded}/${this.loadProgress.total}`
            : "Loading ...",
        )}`
      : this.scope === "current"
        ? `${this.theme.fg("accent", "◉ Current Folder")}${this.theme.fg("muted", " | ○ All")}`
        : `${this.theme.fg("muted", "○ Current Folder | ")}${this.theme.fg("accent", "◉ All")}`;

    const rightText = truncateToWidth(
      `${scopeText}  ${this.theme.fg("muted", "Name: ")}${this.theme.fg("accent", nameLabel)}  ${this.theme.fg("muted", "Sort: ")}${this.theme.fg("accent", sortLabel)}`,
      width,
      "",
    );

    const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1);
    const left = truncateToWidth(leftText, availableLeft, "");
    const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText));

    const hintLine1 = truncateToWidth(
      `${this.keyHint("tui.input.tab", "scope")} ${this.theme.fg("muted", "·")} ${this.theme.fg("muted", 're:<pattern> regex · "phrase" exact')}`,
      width,
      "…",
    );

    const pathState = this.showPath ? "(on)" : "(off)";
    const hintLine2 = truncateToWidth(
      [
        this.keyHint("app.session.toggleSort", "sort"),
        this.keyHint("app.session.toggleNamedFilter", "named"),
        this.keyHint("app.session.delete", "delete"),
        this.keyHint("app.session.togglePath", `path ${pathState}`),
      ].join(` ${this.theme.fg("muted", "·")} `),
      width,
      "…",
    );

    if (this.confirmingDelete) {
      const confirmLabel =
        this.confirmingDelete === "no session"
          ? "Delete orphan checkpoint storage?"
          : "Delete checkpoint storage?";
      const confirmLine = truncateToWidth(
        `${confirmLabel} ${this.keyHint("tui.select.confirm", "confirm")} ${this.theme.fg("muted", "·")} ${this.keyHint("tui.select.cancel", "cancel")}`,
        width,
        "…",
      );
      return [`${left}${" ".repeat(spacing)}${rightText}`, this.theme.fg("error", confirmLine), ""];
    }

    if (this.statusMessage) {
      const color = this.statusMessage.type === "error" ? "error" : "accent";
      return [
        `${left}${" ".repeat(spacing)}${rightText}`,
        truncateToWidth(this.theme.fg(color, this.statusMessage.message), width, "…"),
        "",
      ];
    }

    return [`${left}${" ".repeat(spacing)}${rightText}`, hintLine1, hintLine2];
  }

  private keyHint(keybinding: string, label: string): string {
    return this.theme.fg("dim", this.keyText(keybinding)) + this.theme.fg("muted", ` ${label}`);
  }

  private keyText(keybinding: string): string {
    return this.keybindings.getKeys(keybinding).join("/");
  }
}

export class CheckpointSelectorComponent implements Component, Focusable {
  private readonly searchInput = new Input();
  private readonly header: CheckpointSelectorHeader;
  private readonly titleBorder: DynamicBorder;
  private readonly bottomBorder: DynamicBorder;

  private scope: CheckpointScope = "current";
  private sortMode: CheckpointSortMode = "threaded";
  private nameFilter: CheckpointNameFilter = "all";
  private currentSessions: CheckpointSelectorSession[] | null = null;
  private allSessions: CheckpointSelectorSession[] | null = null;
  private currentLoading = false;
  private allLoading = false;
  private showPath = false;
  private selectedIndex = 0;
  private filteredSessions: FlattenedSessionNode[] = [];
  private confirmingDeletePath: string | null = null;
  private allLoadSeq = 0;
  private maxVisible = 10;
  private _focused = false;

  constructor(private readonly options: CheckpointSelectorOptions) {
    this.header = new CheckpointSelectorHeader(
      this.scope,
      this.sortMode,
      this.nameFilter,
      this.showPath,
      this.options.requestRender,
      this.options.keybindings,
      this.options.theme,
    );
    this.titleBorder = new DynamicBorder((text: string) => this.options.theme.fg("accent", text));
    this.bottomBorder = new DynamicBorder((text: string) => this.options.theme.fg("accent", text));
    this.searchInput.onSubmit = () => {
      const selected = this.filteredSessions[this.selectedIndex]?.session;
      if (selected) this.options.onClose();
    };
    void this.loadScope("current", "initial");
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  invalidate(): void {
    this.titleBorder.invalidate();
    this.bottomBorder.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push("");
    lines.push(...this.titleBorder.render(width));
    lines.push("");
    lines.push(...this.header.render(width));
    lines.push("");
    lines.push(...this.searchInput.render(width));
    lines.push("");

    if (this.filteredSessions.length === 0) {
      lines.push(
        this.options.theme.fg("muted", truncateToWidth("  No sessions found", width, "…")),
      );
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          this.filteredSessions.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(startIndex + this.maxVisible, this.filteredSessions.length);

      for (let index = startIndex; index < endIndex; index++) {
        const node = this.filteredSessions[index]!;
        lines.push(this.renderSessionLine(node, index === this.selectedIndex, width));
      }

      if (startIndex > 0 || endIndex < this.filteredSessions.length) {
        lines.push(
          this.options.theme.fg(
            "muted",
            truncateToWidth(
              `  (${this.selectedIndex + 1}/${this.filteredSessions.length})`,
              width,
              "",
            ),
          ),
        );
      }
    }

    lines.push("");
    lines.push(...this.bottomBorder.render(width));
    return lines.map((line) => truncateToWidth(line, width));
  }

  handleInput(keyData: string): void {
    const kb = this.options.keybindings;

    if (this.confirmingDeletePath !== null) {
      if (kb.matches(keyData, "tui.select.confirm")) {
        void this.confirmDelete();
      } else if (kb.matches(keyData, "tui.select.cancel")) {
        this.confirmingDeletePath = null;
        this.header.setConfirmingDelete(false);
        this.options.requestRender();
      }
      return;
    }

    if (kb.matches(keyData, "tui.input.tab")) {
      this.toggleScope();
      return;
    }
    if (kb.matches(keyData, "app.session.toggleSort")) {
      this.toggleSortMode();
      return;
    }
    if (kb.matches(keyData, "app.session.toggleNamedFilter")) {
      this.toggleNameFilter();
      return;
    }
    if (kb.matches(keyData, "app.session.togglePath")) {
      this.showPath = !this.showPath;
      this.header.setShowPath(this.showPath);
      this.options.requestRender();
      return;
    }
    if (kb.matches(keyData, "app.session.delete")) {
      this.startDeleteConfirmation();
      return;
    }
    if (kb.matches(keyData, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.options.requestRender();
      return;
    }
    if (kb.matches(keyData, "tui.select.down")) {
      this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1);
      this.options.requestRender();
      return;
    }
    if (kb.matches(keyData, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
      this.options.requestRender();
      return;
    }
    if (kb.matches(keyData, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(
        this.filteredSessions.length - 1,
        this.selectedIndex + this.maxVisible,
      );
      this.options.requestRender();
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm")) {
      this.options.onClose();
      return;
    }
    if (kb.matches(keyData, "tui.select.cancel")) {
      this.options.onClose();
      return;
    }

    this.searchInput.handleInput(keyData);
    this.refilter();
    this.options.requestRender();
  }

  private renderSessionLine(
    node: FlattenedSessionNode,
    isSelected: boolean,
    width: number,
  ): string {
    const session = node.session;
    const isCurrent =
      !!this.options.currentSessionPath &&
      normalizeComparablePath(session.path) ===
        normalizeComparablePath(this.options.currentSessionPath);
    const isConfirmingDelete = session.path === this.confirmingDeletePath;

    const prefix = this.buildTreePrefix(node);
    const displayText = session.name ?? session.firstMessage;
    const normalizedMessage = stripControlCharacters(displayText).trim();
    const age = formatSessionAge(session.modified);
    const msgCount = String(session.messageCount);
    const statusLabel = session.checkpointStatus ? `[${session.checkpointStatus}]` : "";

    let rightPart = [statusLabel, msgCount, age].filter((part) => part.length > 0).join(" ");
    if (this.scope === "all" && session.cwd) {
      rightPart = [statusLabel, shortenPathForDisplay(session.cwd), msgCount, age]
        .filter((part) => part.length > 0)
        .join(" ");
    }
    if (this.showPath) {
      rightPart = [statusLabel, shortenPathForDisplay(session.path), msgCount, age]
        .filter((part) => part.length > 0)
        .join(" ");
    }

    const cursor = isSelected ? this.options.theme.fg("accent", "› ") : "  ";
    const prefixWidth = visibleWidth(prefix);
    const rightWidth = visibleWidth(rightPart) + 2;
    const availableForMsg = width - 2 - prefixWidth - rightWidth;
    const truncatedMsg = truncateToWidth(normalizedMessage, Math.max(10, availableForMsg), "…");

    let messageColor: "error" | "accent" | "warning" | null = null;
    if (isConfirmingDelete) messageColor = "error";
    else if (isCurrent) messageColor = "accent";
    else if (session.name) messageColor = "warning";

    let styledMsg = messageColor ? this.options.theme.fg(messageColor, truncatedMsg) : truncatedMsg;
    if (isSelected) {
      styledMsg = this.options.theme.bold(styledMsg);
    }

    const leftPart = cursor + this.options.theme.fg("dim", prefix) + styledMsg;
    const leftWidth = visibleWidth(leftPart);
    const spacing = Math.max(1, width - leftWidth - visibleWidth(rightPart));
    const styledRight = this.options.theme.fg(isConfirmingDelete ? "error" : "dim", rightPart);
    let line = leftPart + " ".repeat(spacing) + styledRight;
    if (isSelected) {
      line = this.options.theme.bg("selectedBg", line);
    }
    return truncateToWidth(line, width);
  }

  private buildTreePrefix(node: FlattenedSessionNode): string {
    if (node.depth === 0) return "";
    const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
    const branch = node.isLast ? "└─ " : "├─ ";
    return parts.join("") + branch;
  }

  private startDeleteConfirmation(): void {
    const selected = this.filteredSessions[this.selectedIndex]?.session;
    if (!selected) return;
    if (this.isCurrentSessionPath(selected.path)) {
      this.header.setStatusMessage(
        { type: "error", message: "Cannot delete the currently active checkpoint storage" },
        3000,
      );
      this.options.requestRender();
      return;
    }
    this.confirmingDeletePath = selected.path;
    this.header.setConfirmingDelete(selected.checkpointStatus ?? "storage");
    this.options.requestRender();
  }

  private async confirmDelete(): Promise<void> {
    const selected = this.filteredSessions[this.selectedIndex]?.session;
    this.confirmingDeletePath = null;
    this.header.setConfirmingDelete(false);
    if (!selected) return;

    try {
      const result = await this.options.deleteStorage(selected);
      if (!result.ok) {
        this.header.setStatusMessage({ type: "error", message: result.message }, 3000);
        this.options.requestRender();
        return;
      }

      this.header.setStatusMessage({ type: "info", message: "Checkpoint storage deleted" }, 2000);
      this.applyOptimisticDelete(selected);
      this.options.requestRender();

      void Promise.all([this.options.currentLoader(), this.options.allLoader()])
        .then(([currentSessions, allSessions]) => {
          this.currentSessions = currentSessions;
          this.allSessions = allSessions;
          this.setVisibleSessionsForScope(this.scope);
          this.options.requestRender();
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.header.setStatusMessage(
            { type: "error", message: `Checkpoint list refresh failed: ${message}` },
            3000,
          );
          this.options.requestRender();
        });
    } catch (error) {
      this.header.setStatusMessage(
        {
          type: "error",
          message: `Checkpoint storage delete failed: ${errorMessage(error)}`,
        },
        4000,
      );
      this.options.requestRender();
    }
  }

  private applyOptimisticDelete(selected: CheckpointSelectorSession): void {
    this.currentSessions = this.applyDeletedCheckpointStorage(
      this.currentSessions,
      selected,
      "current",
    );
    this.allSessions = this.applyDeletedCheckpointStorage(this.allSessions, selected, "all");
    this.setVisibleSessionsForScope(this.scope);
  }

  private applyDeletedCheckpointStorage(
    sessions: readonly CheckpointSelectorSession[] | null,
    selected: CheckpointSelectorSession,
    scope: CheckpointScope,
  ): CheckpointSelectorSession[] {
    if (!sessions) return [];

    return sessions.flatMap((session) => {
      if (selected.checkpointRepoDir && session.checkpointRepoDir === selected.checkpointRepoDir) {
        if (scope === "all" && selected.sourceSessionFile) {
          return [this.toNoCheckpointSession(selected)];
        }
        return [];
      }
      return [session];
    });
  }

  private toNoCheckpointSession(session: CheckpointSelectorSession): CheckpointSelectorSession {
    const baseTitle = normalizeTitle(session.name ?? session.firstMessage);
    return {
      ...session,
      path: session.sourceSessionFile ?? session.path,
      firstMessage: session.name ? normalizeTitle(session.firstMessage) : baseTitle,
      allMessagesText: `${baseTitle} no checkpoints session without checkpoint history ${session.cwd}`,
      checkpointRepoDir: undefined,
      checkpointStatus: "no checkpoints",
    };
  }

  private isCurrentSessionPath(pathToCheck: string): boolean {
    return (
      !!this.options.currentSessionPath &&
      normalizeComparablePath(pathToCheck) ===
        normalizeComparablePath(this.options.currentSessionPath)
    );
  }

  private toggleSortMode(): void {
    this.sortMode =
      this.sortMode === "threaded"
        ? "recent"
        : this.sortMode === "recent"
          ? "relevance"
          : "threaded";
    this.header.setSortMode(this.sortMode);
    this.refilter();
    this.options.requestRender();
  }

  private toggleNameFilter(): void {
    this.nameFilter = this.nameFilter === "all" ? "named" : "all";
    this.header.setNameFilter(this.nameFilter);
    this.refilter();
    this.options.requestRender();
  }

  private toggleScope(): void {
    if (this.scope === "current") {
      this.scope = "all";
      this.header.setScope(this.scope);
      if (this.allSessions !== null) {
        this.header.setLoading(false);
        this.setVisibleSessionsForScope("all");
        this.options.requestRender();
        return;
      }
      if (!this.allLoading) {
        void this.loadScope("all", "toggle");
      }
      return;
    }

    this.scope = "current";
    this.header.setScope(this.scope);
    this.header.setLoading(this.currentLoading);
    this.setVisibleSessionsForScope("current");
    this.options.requestRender();
  }

  private async loadScope(scope: CheckpointScope, reason: "initial" | "toggle"): Promise<void> {
    const isAll = scope === "all";
    if (isAll) {
      this.allLoading = true;
    } else {
      this.currentLoading = true;
    }

    const seq = isAll ? ++this.allLoadSeq : undefined;
    this.header.setScope(scope);
    this.header.setLoading(true);
    this.options.requestRender();

    const onProgress = (loaded: number, total: number): void => {
      if (scope !== this.scope) return;
      if (seq !== undefined && seq !== this.allLoadSeq) return;
      this.header.setProgress(loaded, total);
      this.options.requestRender();
    };

    try {
      const sessions = await (isAll
        ? this.options.allLoader(onProgress)
        : this.options.currentLoader(onProgress));
      if (isAll) {
        this.allSessions = sessions;
        this.allLoading = false;
      } else {
        this.currentSessions = sessions;
        this.currentLoading = false;
      }

      if (scope !== this.scope) return;
      if (seq !== undefined && seq !== this.allLoadSeq) return;

      this.header.setLoading(false);
      this.setVisibleSessionsForScope(scope);
      this.options.requestRender();
    } catch (error) {
      if (isAll) this.allLoading = false;
      else this.currentLoading = false;

      if (scope !== this.scope) return;
      if (seq !== undefined && seq !== this.allLoadSeq) return;

      const message = error instanceof Error ? error.message : String(error);
      this.header.setLoading(false);
      this.header.setStatusMessage(
        { type: "error", message: `Failed to load sessions: ${message}` },
        4000,
      );
      if (reason === "initial") {
        this.filteredSessions = [];
      }
      this.options.requestRender();
    }
  }

  private setVisibleSessionsForScope(scope: CheckpointScope): void {
    const sessions = scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
    this.filteredSessions = this.filterSessions(sessions, this.searchInput.getValue());
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredSessions.length - 1),
    );
  }

  private refilter(): void {
    this.setVisibleSessionsForScope(this.scope);
  }

  private filterSessions(
    sessions: readonly CheckpointSelectorSession[],
    query: string,
  ): FlattenedSessionNode[] {
    const trimmed = query.trim();
    const nameFiltered =
      this.nameFilter === "all" ? sessions : sessions.filter((session) => hasSessionName(session));

    if (this.sortMode === "threaded" && !trimmed) {
      return flattenSessionTree(buildSessionTree(nameFiltered));
    }

    return filterAndSortSessions(nameFiltered, query, this.sortMode, "all").map((session) => ({
      session,
      depth: 0,
      isLast: true,
      ancestorContinues: [],
    }));
  }
}

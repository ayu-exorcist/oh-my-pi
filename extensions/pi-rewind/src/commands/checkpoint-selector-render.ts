import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  CheckpointScope,
  CheckpointSelectorSession,
  CheckpointSelectorTheme,
} from "./checkpoint-selector";
import {
  formatSessionAge,
  normalizeComparablePath,
  shortenPathForDisplay,
  stripControlCharacters,
  type FlattenedSessionNode,
} from "./checkpoint-selector-helpers";

export interface RenderSessionLineOptions {
  readonly node: FlattenedSessionNode;
  readonly isSelected: boolean;
  readonly width: number;
  readonly scope: CheckpointScope;
  readonly showPath: boolean;
  readonly currentSessionPath?: string | undefined;
  readonly confirmingDeletePath: string | null;
  readonly theme: CheckpointSelectorTheme;
}

export function buildTreePrefix(node: FlattenedSessionNode): string {
  if (node.depth === 0) return "";
  const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
  const branch = node.isLast ? "└─ " : "├─ ";
  return parts.join("") + branch;
}

function getRightPart(
  session: CheckpointSelectorSession,
  scope: CheckpointScope,
  showPath: boolean,
): string {
  const age = formatSessionAge(session.modified);
  const msgCount = String(session.messageCount);
  const statusLabel = session.checkpointStatus ? `[${session.checkpointStatus}]` : "";

  if (showPath) {
    return [statusLabel, shortenPathForDisplay(session.path), msgCount, age]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  if (scope === "all" && session.cwd) {
    return [statusLabel, shortenPathForDisplay(session.cwd), msgCount, age]
      .filter((part) => part.length > 0)
      .join(" ");
  }

  return [statusLabel, msgCount, age].filter((part) => part.length > 0).join(" ");
}

export function renderSessionLine(options: RenderSessionLineOptions): string {
  const {
    node,
    isSelected,
    width,
    scope,
    showPath,
    currentSessionPath,
    confirmingDeletePath,
    theme,
  } = options;
  const session = node.session;
  const isCurrent =
    !!currentSessionPath &&
    normalizeComparablePath(session.path) === normalizeComparablePath(currentSessionPath);
  const isConfirmingDelete = session.path === confirmingDeletePath;

  const prefix = buildTreePrefix(node);
  const displayText = session.name ?? session.firstMessage;
  const normalizedMessage = stripControlCharacters(displayText).trim();
  const rightPart = getRightPart(session, scope, showPath);

  const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
  const prefixWidth = visibleWidth(prefix);
  const rightWidth = visibleWidth(rightPart) + 2;
  const availableForMsg = width - 2 - prefixWidth - rightWidth;
  const truncatedMsg = truncateToWidth(normalizedMessage, Math.max(10, availableForMsg), "…");

  let messageColor: "error" | "accent" | "warning" | null = null;
  if (isConfirmingDelete) messageColor = "error";
  else if (isCurrent) messageColor = "accent";
  else if (session.name) messageColor = "warning";

  let styledMsg = messageColor ? theme.fg(messageColor, truncatedMsg) : truncatedMsg;
  if (isSelected) {
    styledMsg = theme.bold(styledMsg);
  }

  const leftPart = cursor + theme.fg("dim", prefix) + styledMsg;
  const leftWidth = visibleWidth(leftPart);
  const spacing = Math.max(1, width - leftWidth - visibleWidth(rightPart));
  const styledRight = theme.fg(isConfirmingDelete ? "error" : "dim", rightPart);
  let line = leftPart + " ".repeat(spacing) + styledRight;
  if (isSelected) {
    line = theme.bg("selectedBg", line);
  }
  return truncateToWidth(line, width);
}

import type {
  CheckpointNameFilter,
  CheckpointSelectorSession,
  CheckpointSortMode,
} from "./checkpoint-selector";

export interface SessionTreeNode {
  readonly session: CheckpointSelectorSession;
  readonly children: SessionTreeNode[];
}

export interface FlattenedSessionNode {
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

export function normalizeComparablePath(inputPath: string | undefined): string | undefined {
  if (!inputPath) return undefined;
  const resolved = inputPath.replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function normalizeTitle(input: string | undefined): string {
  const collapsed = input?.replace(/\s+/g, " ").trim() ?? "";
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function stripControlCharacters(input: string): string {
  return Array.from(input, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? " " : char;
  }).join("");
}

export function hasSessionName(session: CheckpointSelectorSession): boolean {
  return Boolean(session.name?.trim());
}

function getSessionSearchText(session: CheckpointSelectorSession): string {
  return `${session.id} ${session.name ?? ""} ${session.firstMessage} ${session.allMessagesText} ${session.cwd}`;
}

export function shortenPathForDisplay(inputPath: string): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  if (!home) return inputPath;
  const normalizedHome = home.replace(/\\/g, "/");
  const normalizedPath = inputPath.replace(/\\/g, "/");
  if (normalizedPath.startsWith(normalizedHome)) {
    return `~${normalizedPath.slice(normalizedHome.length)}`;
  }
  return inputPath;
}

export function formatSessionAge(date: Date): string {
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

export function parseSearchQuery(query: string): ParsedSearchQuery {
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

export function matchSession(
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

export function buildSessionTree(
  sessions: readonly CheckpointSelectorSession[],
): SessionTreeNode[] {
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

export function flattenSessionTree(roots: readonly SessionTreeNode[]): FlattenedSessionNode[] {
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

export function filterAndSortSessions(
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

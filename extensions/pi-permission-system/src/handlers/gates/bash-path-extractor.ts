import { createRequire } from "node:module";
import { posix } from "node:path";

import {
  isPathWithinDirectory,
  isSafeSystemPath,
  normalizePathForComparison,
} from "#src/path-utils";

// ── tree-sitter-bash lazy parser ───────────────────────────────────────────

/**
 * Minimal subset of web-tree-sitter's SyntaxNode used by the AST walker.
 * Defined locally so callers do not need to import web-tree-sitter types.
 */
interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  child(index: number): TSNode | null;
}

/**
 * Minimal subset of web-tree-sitter's Parser used by this module.
 */
interface TSParser {
  parse(input: string): { rootNode: TSNode; delete(): void } | null;
  delete(): void;
}

let parserPromise: Promise<TSParser> | null = null;

async function initParser(): Promise<TSParser> {
  // Use named imports — web-tree-sitter exports Parser as a named class.
  const { Parser, Language } = await import("web-tree-sitter");
  const req = createRequire(import.meta.url);
  const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => treeSitterWasm });

  const parser = new Parser();
  const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const bash = await Language.load(bashWasm);
  parser.setLanguage(bash);
  return parser;
}

function getParser(): Promise<TSParser> {
  parserPromise ??= initParser();
  return parserPromise;
}

// ── AST walker ─────────────────────────────────────────────────────────────

/**
 * Node types whose subtrees must never be descended into for
 * path extraction — their text content is not a command argument.
 */
const SKIP_SUBTREE_TYPES = new Set(["heredoc_body", "heredoc_end", "comment"]);

/**
 * Resolve the "shell value" of an argument node — the string the shell
 * would pass to the command after quote removal.
 *
 * - `word`          → `.text` (already unquoted)
 * - `raw_string`    → strip surrounding single quotes
 * - `string`        → strip surrounding double quotes, concatenate children text
 * - `concatenation` → concatenate resolved children
 * - other           → `.text` as fallback
 */
function resolveNodeText(node: TSNode): string {
  switch (node.type) {
    case "word":
      return node.text;
    case "raw_string": {
      // Strip surrounding single quotes: 'content' → content
      const t = node.text;
      if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
        return t.slice(1, -1);
      }
      return t;
    }
    case "string": {
      // Double-quoted string: concatenate the resolved text of inner children,
      // skipping the quote-delimiter nodes (literal `"`).
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        // Skip the literal `"` delimiters
        if (child.type === '"') continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    case "string_content":
    case "simple_expansion":
    case "expansion":
      return node.text;
    case "concatenation": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    default:
      return node.text;
  }
}

// ── Pattern-first command config ───────────────────────────────────────────

interface PatternCommandConfig {
  /** Flags that consume the next argument as a non-path value (pattern, separator, etc.) */
  readonly argConsumingFlags: ReadonlySet<string>;
  /** Flags that consume the next argument as a file path */
  readonly fileConsumingFlags: ReadonlySet<string>;
  /**
   * Number of leading positional arguments that are patterns/scripts, not paths.
   * Default: 1 (covers sed, awk, grep, rg).
   * sd uses 2 (FIND and REPLACE_WITH are both non-path positionals).
   */
  readonly patternPositionals?: number;
}

/**
 * Commands whose first N positional arguments are inline patterns/scripts,
 * not filesystem paths. The map stores per-command flag configuration so
 * the walker can correctly identify which arguments are consumed by flags
 * vs. which are positional.
 */
const PATTERN_FIRST_COMMANDS: ReadonlyMap<string, PatternCommandConfig> = new Map([
  [
    "sed",
    {
      argConsumingFlags: new Set(["-e", "-i"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "awk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "gawk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "nawk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "grep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "egrep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "fgrep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "rg",
    {
      argConsumingFlags: new Set([
        "-e",
        "-A",
        "-B",
        "-C",
        "-m",
        "-g",
        "-t",
        "-T",
        "-j",
        "-M",
        "-r",
        "-E",
      ]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "sd",
    {
      argConsumingFlags: new Set(["-n", "-f"]),
      fileConsumingFlags: new Set([]),
      patternPositionals: 2,
    },
  ],
]);

/** Node types that represent argument values in the AST. */
const ARG_NODE_TYPES = new Set(["word", "concatenation", "string", "raw_string"]);

/**
 * Extract the command name from a `command` node.
 * Returns the basename (e.g. `/usr/bin/sed` → `sed`), or undefined
 * if the command name cannot be determined (e.g. variable expansion).
 */
function extractCommandName(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name") {
      const text = resolveNodeText(child);
      return text ? posix.basename(text.replace(/\\/g, "/")) : undefined;
    }
  }
  return undefined;
}

/**
 * Collect path-candidate tokens from a command known to have
 * pattern/script arguments in leading positional slots.
 *
 * Uses position-based skipping: the first N positional arguments
 * (where N = patternPositionals, default 1) are assumed to be
 * inline patterns/scripts and are skipped. Remaining positional
 * arguments are collected as path candidates.
 *
 * Flags listed in `argConsumingFlags` consume the next argument
 * (skipped). Flags in `fileConsumingFlags` consume the next
 * argument as a file path (collected). The flags `-e` and `-f`
 * additionally signal that an explicit script was provided via
 * flag, so no inline positional script is expected.
 */
function collectPatternCommandTokens(
  node: TSNode,
  tokens: string[],
  config: PatternCommandConfig,
): void {
  const patternPositionals = config.patternPositionals ?? 1;
  let hasExplicitScript = false;
  let positionalsSeen = 0;
  let nextArgAction: "skip" | "extract" | null = null;
  let pastEndOfFlags = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    // Skip command_name and variable_assignment nodes.
    if (child.type === "command_name" || child.type === "variable_assignment") continue;

    // Only process argument-like nodes; recurse into others
    // (e.g. command_substitution) for nested commands.
    if (!ARG_NODE_TYPES.has(child.type)) {
      collectPathCandidateTokens(child, tokens);
      continue;
    }

    const text = resolveNodeText(child);

    // Handle consumed argument from previous flag.
    if (nextArgAction === "skip") {
      nextArgAction = null;
      continue;
    }
    if (nextArgAction === "extract") {
      tokens.push(text);
      nextArgAction = null;
      continue;
    }

    // Flag detection (only before "--" end-of-flags marker).
    if (!pastEndOfFlags && child.type === "word" && text.startsWith("-") && text.length > 1) {
      if (text === "--") {
        pastEndOfFlags = true;
        continue;
      }
      if (config.argConsumingFlags.has(text)) {
        nextArgAction = "skip";
        if (text === "-e" || text === "-f") {
          hasExplicitScript = true;
        }
        continue;
      }
      if (config.fileConsumingFlags.has(text)) {
        nextArgAction = "extract";
        hasExplicitScript = true;
        continue;
      }
      // Regular flag — skip it.
      continue;
    }

    // Positional argument.
    if (!hasExplicitScript && positionalsSeen < patternPositionals) {
      positionalsSeen++;
      continue; // Skip: this is an inline pattern/script.
    }

    // File argument — collect as path candidate.
    tokens.push(text);
  }
}

/**
 * Recursively visit the AST and collect resolved text of nodes that
 * represent command arguments or redirect destinations.
 *
 * Skips `heredoc_body`, `heredoc_end`, and `comment` subtrees entirely.
 *
 * For commands in `PATTERN_FIRST_COMMANDS`, uses position-based
 * argument skipping to avoid collecting inline patterns/scripts
 * as path candidates. For all other commands, collects all
 * arguments generically.
 */
function collectPathCandidateTokens(node: TSNode, tokens: string[]): void {
  if (SKIP_SUBTREE_TYPES.has(node.type)) return;

  // Extract arguments from `command` nodes.
  if (node.type === "command") {
    const commandName = extractCommandName(node);
    const patternConfig = commandName ? PATTERN_FIRST_COMMANDS.get(commandName) : undefined;

    if (patternConfig) {
      collectPatternCommandTokens(node, tokens, patternConfig);
      return;
    }

    // Generic extraction: collect all arguments (skip command name).
    let seenCommandName = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;

      if (child.type === "command_name") {
        seenCommandName = true;
        continue;
      }
      // Skip variable_assignment nodes (FOO=/bar)
      if (child.type === "variable_assignment") continue;

      // If there was no explicit command_name node, the first word-like
      // child is the command name itself — skip it.
      if (!seenCommandName && ARG_NODE_TYPES.has(child.type)) {
        seenCommandName = true;
        continue;
      }

      // Argument nodes: resolve their text and collect.
      if (ARG_NODE_TYPES.has(child.type)) {
        tokens.push(resolveNodeText(child));
        continue;
      }

      // Recurse into other children (e.g. command_substitution nested in args)
      collectPathCandidateTokens(child, tokens);
    }
    return;
  }

  // Extract redirect destinations from `file_redirect` nodes.
  if (node.type === "file_redirect") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (
        child.type === "word" ||
        child.type === "concatenation" ||
        child.type === "string" ||
        child.type === "raw_string"
      ) {
        tokens.push(resolveNodeText(child));
      }
    }
    return;
  }

  // For all other node types, recurse into children.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    collectPathCandidateTokens(child, tokens);
  }
}

/**
 * URL pattern to skip tokens that look like URLs rather than paths.
 */
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/][^\s'"`;|&]+/g;

/**
 * Regex metacharacter sequences that are never found in real filesystem paths.
 * If a token contains any of these, it is almost certainly a regex pattern
 * (e.g. a grep argument) rather than a path.
 */
const REGEX_METACHAR_PATTERN = /\.\*|\.\+|\\\||\\\(|\\\)|\[.*?\]|\^\//;

/**
 * Broader token classification for cross-cutting `path` rules.
 *
 * Accepts the same rejections as `classifyTokenAsPathCandidate` (empty, flags,
 * env assignments, URLs, @scope/package, bare-slash, regex metacharacters),
 * but also accepts:
 * - Tokens starting with `.` (dot-files: `.env`, `./src`)
 * - Tokens containing `/` (relative paths: `src/foo.ts`)
 *
 * Does NOT require the strict "must start with `/` or `~/` or contain `..`"
 * gate that the external-directory classifier uses.
 */
function classifyTokenAsRuleCandidate(token: string): string | null {
  if (!token) return null;
  if (token.startsWith("-")) return null;

  const eqIndex = token.indexOf("=");
  const slashIndex = token.search(/[\\/]/);
  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(token);
  if (eqIndex !== -1 && !isWindowsAbsolutePath && (slashIndex === -1 || eqIndex < slashIndex)) {
    return null;
  }

  if (URL_PATTERN.test(token)) return null;
  if (token.startsWith("@") && !token.startsWith("@/")) return null;
  if (/^\/+$/.test(token)) return null;
  if (REGEX_METACHAR_PATTERN.test(token)) return null;

  // Accept: starts with . (dot-files, ./ relative), contains / (paths),
  // starts with / or ~/ (absolute/home), or contains .. (parent traversal).
  if (token.startsWith(".")) return token;
  if (token.includes("/") || token.includes("\\")) return token;
  if (token.startsWith("~/") || token.startsWith("~\\")) return token;
  if (isWindowsAbsolutePath) return token;
  if (token.includes("..")) return token;

  return null;
}

/**
 * Determines whether a token looks like a path candidate worth resolving.
 * Returns the raw token string if it's a candidate, or null to skip.
 */
function classifyTokenAsPathCandidate(token: string): string | null {
  // Skip empty tokens
  if (!token) return null;

  // Skip flags
  if (token.startsWith("-")) return null;

  // Skip env assignments (FOO=/bar)
  const eqIndex = token.indexOf("=");
  const slashIndex = token.search(/[\\/]/);
  const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]/.test(token);
  if (eqIndex !== -1 && !isWindowsAbsolutePath && (slashIndex === -1 || eqIndex < slashIndex)) {
    return null;
  }

  // Skip URLs
  if (URL_PATTERN.test(token)) return null;

  // Skip @scope/package patterns
  if (token.startsWith("@") && !token.startsWith("@/")) return null;

  // Skip bare-slash tokens (// JS comments, lone /, etc.) — they resolve to root
  // and are never meaningful path arguments in practice.
  if (/^\/+$/.test(token)) return null;

  // Skip tokens that contain regex metacharacter sequences — these are almost
  // certainly grep/sed/awk patterns, not filesystem paths.
  // Matches: .*, .+, \|, \(, \), [...], or ^/ (anchored regex starting with /)
  if (REGEX_METACHAR_PATTERN.test(token)) return null;

  // Must look like a path: starts with /, ~/, or contains ..
  if (token.startsWith("/") || isWindowsAbsolutePath) return token;
  if (token.startsWith("~/") || token.startsWith("~\\")) return token;
  if (token.includes("..")) return token;

  return null;
}

// ── Leading cd detection ───────────────────────────────────────────────────

/**
 * Walk down from the root to find the first `command` node in the program.
 *
 * Only descends into `program` and `list` nodes — subshells, pipelines, and
 * other compound statements are ignored because a `cd` inside them does not
 * affect the outer shell's working directory.
 */
function findFirstCommand(node: TSNode): TSNode | null {
  if (node.type === "command") return node;
  if (node.type === "program" || node.type === "list") {
    const firstChild = node.child(0);
    if (firstChild) return findFirstCommand(firstChild);
  }
  return null;
}

/**
 * Extract the target directory of a leading `cd` command from the parsed AST.
 *
 * When a bash command begins with `cd <dir> && …`, the shell resolves
 * subsequent relative paths against `<dir>`, not the original working
 * directory.  The external-directory guard must do the same, otherwise a
 * path that the shell keeps inside the working directory can appear to
 * escape it and trigger a spurious permission prompt.
 *
 * Returns `undefined` when the first command is not `cd`, or when the
 * target cannot be meaningfully resolved (`cd -`, bare `cd`, or `cd ~…`).
 */
function extractLeadingCdTarget(rootNode: TSNode): string | undefined {
  const firstCmd = findFirstCommand(rootNode);
  if (!firstCmd) return undefined;

  const cmdName = extractCommandName(firstCmd);
  if (cmdName !== "cd") return undefined;

  for (let i = 0; i < firstCmd.childCount; i++) {
    const child = firstCmd.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment") continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;

    const text = resolveNodeText(child);
    // Skip `--` (end-of-flags marker)
    if (text === "--") continue;
    // `cd -` jumps to $OLDPWD; `cd ~…` is home-relative — neither can be
    // resolved against the working directory.
    if (text === "-" || text.startsWith("~")) return undefined;
    return text;
  }
  return undefined;
}

/**
 * Compute the effective base directory for resolving relative path candidates.
 *
 * When the leading `cd` target stays within the working directory, subsequent
 * relative paths should be resolved against it.  An escaping target is itself
 * an external access (reported via its own candidate token) and must never
 * silence checks on subsequent paths, so the function falls back to `cwd`.
 */
function computeEffectiveResolveBase(cdTarget: string | undefined, cwd: string): string {
  if (cdTarget === undefined) return cwd;
  const resolved = normalizePathForComparison(cdTarget, cwd);
  const normalizedCwd = normalizePathForComparison(cwd, cwd);
  return isPathWithinDirectory(resolved, normalizedCwd) ? resolved : cwd;
}

// ── Public extractors ──────────────────────────────────────────────────────

/**
 * Extracts paths from a bash command string that resolve outside CWD.
 * Uses tree-sitter-bash to parse the command into a full AST, then walks
 * command argument and redirect-destination nodes.  Heredoc bodies, comments,
 * and other non-argument content are skipped, eliminating false positives.
 *
 * When the command begins with `cd <dir> && …`, relative candidate paths are
 * resolved against `<dir>` (if it stays within CWD) rather than CWD itself,
 * mirroring how the shell would resolve them.
 */
export async function extractExternalPathsFromBashCommand(
  command: string,
  cwd: string,
): Promise<string[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) return [];

  let cdTarget: string | undefined;
  const tokens: string[] = [];
  try {
    cdTarget = extractLeadingCdTarget(tree.rootNode);
    collectPathCandidateTokens(tree.rootNode, tokens);
  } finally {
    tree.delete();
  }

  tokens.push(...Array.from(command.matchAll(WINDOWS_ABSOLUTE_PATH_PATTERN), (match) => match[0]));

  const resolveBase = computeEffectiveResolveBase(cdTarget, cwd);
  const normalizedCwd = normalizePathForComparison(cwd, cwd);

  const seen = new Set<string>();
  const externalPaths: string[] = [];

  for (const token of tokens) {
    const candidate = classifyTokenAsPathCandidate(token);
    if (!candidate) continue;

    const normalized = normalizePathForComparison(candidate, resolveBase);
    if (!normalized) continue;

    if (
      normalizedCwd !== "" &&
      !isSafeSystemPath(normalized) &&
      !isPathWithinDirectory(normalized, normalizedCwd) &&
      !seen.has(normalized)
    ) {
      seen.add(normalized);
      externalPaths.push(normalized);
    }
  }

  return externalPaths;
}

/**
 * Extract tokens from a bash command that may be file paths, using a broader
 * filter suitable for cross-cutting `path` permission rules.
 *
 * Unlike `extractExternalPathsFromBashCommand`, this function:
 * - Accepts relative paths (`.env`, `src/foo.ts`, `./build`)
 * - Does NOT filter by CWD — returns raw tokens for rule evaluation
 * - Returns deduplicated tokens
 */
export async function extractTokensForPathRules(command: string): Promise<string[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) return [];

  const tokens: string[] = [];
  try {
    collectPathCandidateTokens(tree.rootNode, tokens);
  } finally {
    tree.delete();
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of tokens) {
    const candidate = classifyTokenAsRuleCandidate(token);
    if (!candidate) continue;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }

  return result;
}

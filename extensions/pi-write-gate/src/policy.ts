import { isBashToolName, classifyBashRiskTier } from "./gate";
import { getStringField } from "./gate";
import type { GateSettings } from "./settings";

export type RiskTier = "T0" | "T1" | "T2" | "T3" | "T4";

export interface PolicyResult {
  readonly tier: RiskTier | null;
  readonly isProtectedPath: boolean;
  readonly isAutoAllowable: boolean;
  readonly reason: string;
}

const DEFAULT_PROTECTED_PATH_PATTERNS = [
  /\.git\b/,
  /\.vscode\b/,
  /\.idea\b/,
  /\.bashrc/,
  /\.zshrc/,
  /\.profile/,
  /\.gitconfig/,
  /\.gitmodules/,
  /\.npmrc/,
  /\.env/,
  /\.mcp\.json/,
  /\.claude\.json/,
];

const SAFE_BASH_PREFIXES = [
  "git status",
  "git --no-pager status",
  "git diff",
  "git --no-pager diff",
  "git log",
  "git --no-pager log",
  "git show",
  "git --no-pager show",
  "git branch --show-current",
  "mkdir ",
  "touch ",
  "mv ",
  "cp ",
  "rmdir ",
];

const UNSAFE_BASH_KEYWORDS = [
  "curl",
  "wget",
  "ssh",
  "sudo",
  "docker",
  "kubectl",
  "terraform",
  "ansible",
];

function buildProtectedPathPatterns(settings?: GateSettings): RegExp[] {
  const patterns = [...DEFAULT_PROTECTED_PATH_PATTERNS];
  if (settings?.protectedPaths) {
    for (const p of settings.protectedPaths) {
      try {
        // Escape regex special chars, then wrap with word boundary if it looks like a filename
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        patterns.push(new RegExp(escaped));
      } catch {
        // Ignore invalid regex patterns
      }
    }
  }
  return patterns;
}

function isProtectedPath(text: string, settings?: GateSettings): boolean {
  const patterns = buildProtectedPathPatterns(settings);
  return patterns.some((pattern) => pattern.test(text));
}

function isAllowlistedBash(command: string, settings?: GateSettings): boolean {
  const list = settings?.allowlist?.bash;
  if (!list || list.length === 0) return false;
  const trimmed = command.trim();
  return list.some((prefix) => trimmed.startsWith(prefix));
}

function isAllowlistedTool(toolName: string, settings?: GateSettings): boolean {
  const list = settings?.allowlist?.tools;
  if (!list || list.length === 0) return false;
  return list.includes(toolName);
}

function isSafeBashPrefix(command: string): boolean {
  const trimmed = command.trim();
  return SAFE_BASH_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function hasUnsafeBashKeyword(command: string): boolean {
  const lower = command.toLowerCase();
  return UNSAFE_BASH_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isPotentiallyDestructiveBash(command: string): boolean {
  const trimmed = command.trim();
  // Block recursive rm or force flags that are commonly destructive
  if (/\\brm\\s+.*-rf?\\b/.test(trimmed)) return true;
  if (/\\brm\\s+.*--recursive\\b/.test(trimmed)) return true;
  // Block complex shell syntax that can hide side effects
  if (/[;\u0026|\u003c\u003e$]/.test(trimmed)) return true;
  return false;
}

export function evaluatePolicy(
  toolName: string,
  input: unknown,
  settings?: GateSettings,
): PolicyResult {
  // Allowlisted tools bypass default classification (but T3/T4 still checked for bash)
  const isToolAllowlisted = isAllowlistedTool(toolName, settings);

  // Bash commands get the most detailed analysis
  if (isBashToolName(toolName)) {
    const command = getStringField(input, "command") ?? "";

    // T3/T4 block always takes precedence, even for allowlisted commands
    const tier = classifyBashRiskTier(command, settings?.riskRules);
    if (tier === "T4") {
      return {
        tier: "T4",
        isProtectedPath: false,
        isAutoAllowable: false,
        reason: "Blocked T4: production-mutating command requires explicit approval",
      };
    }
    if (tier === "T3") {
      return {
        tier: "T3",
        isProtectedPath: false,
        isAutoAllowable: false,
        reason: "Blocked T3: irreversible command requires dry-run/backup/approval",
      };
    }

    // Allowlist check for bash (after T3/T4)
    if (isAllowlistedBash(command, settings)) {
      return {
        tier: "T1",
        isProtectedPath: false,
        isAutoAllowable: true,
        reason: "Allowlisted bash command",
      };
    }

    // Protected paths in bash (e.g. rm .git/config)
    if (isProtectedPath(command, settings)) {
      return {
        tier: "T1",
        isProtectedPath: true,
        isAutoAllowable: false,
        reason: "Protected path detected; explicit approval required",
      };
    }

    // Destructive or complex syntax → not auto-allowable
    if (isPotentiallyDestructiveBash(command)) {
      return {
        tier: "T1",
        isProtectedPath: false,
        isAutoAllowable: false,
        reason: "Potentially destructive or complex shell syntax; approval required",
      };
    }

    // Known unsafe keywords
    if (hasUnsafeBashKeyword(command)) {
      return {
        tier: "T1",
        isProtectedPath: false,
        isAutoAllowable: false,
        reason: "Contains external infrastructure keyword; approval required",
      };
    }

    // Safe known prefixes → auto-allowable
    if (isSafeBashPrefix(command)) {
      return {
        tier: "T1",
        isProtectedPath: false,
        isAutoAllowable: true,
        reason: "Safe local filesystem command",
      };
    }

    // Everything else bash is T1 but requires approval in auto mode
    return {
      tier: "T1",
      isProtectedPath: false,
      isAutoAllowable: false,
      reason: "Unrecognized bash command; approval required in auto mode",
    };
  }

  // Non-bash tools: check for protected paths in common fields
  const pathValue =
    getStringField(input, "path") ??
    getStringField(input, "file_path") ??
    getStringField(input, "destination") ??
    "";

  if (isProtectedPath(pathValue, settings)) {
    return {
      tier: "T1",
      isProtectedPath: true,
      isAutoAllowable: false,
      reason: "Protected path detected; explicit approval required",
    };
  }

  // Allowlisted tools
  if (isToolAllowlisted) {
    return {
      tier: "T1",
      isProtectedPath: false,
      isAutoAllowable: true,
      reason: "Allowlisted tool",
    };
  }

  // Write/Edit tools targeting workspace files → auto-allowable
  if (toolName === "write" || toolName === "edit") {
    return {
      tier: "T1",
      isProtectedPath: false,
      isAutoAllowable: true,
      reason: "Local file edit",
    };
  }

  // Read-only tools
  if (
    toolName === "read" ||
    toolName === "read_file" ||
    toolName === "grep" ||
    toolName === "search"
  ) {
    return {
      tier: "T0",
      isProtectedPath: false,
      isAutoAllowable: true,
      reason: "Read-only tool",
    };
  }

  // Default for remaining mutating-looking tools
  return {
    tier: "T1",
    isProtectedPath: false,
    isAutoAllowable: false,
    reason: "Potentially mutating tool; approval required in auto mode",
  };
}

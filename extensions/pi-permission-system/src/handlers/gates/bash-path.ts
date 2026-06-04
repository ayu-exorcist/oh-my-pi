import { getNonEmptyString, toRecord } from "#src/common";
import type { Rule } from "#src/rule";
import { deriveApprovalPattern } from "#src/session-rules";
import type { PermissionCheckResult } from "#src/types";
import { extractTokensForPathRules } from "./bash-path-extractor";
import type { GateResult } from "./descriptor";
import { formatPathAskPrompt } from "./path";
import type { ToolCallContext } from "./types";

/** Function type for checkPermission used by the descriptor factory. */
type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Rule[],
) => PermissionCheckResult;

/**
 * Build a pure descriptor for the cross-cutting path permission gate (bash).
 *
 * Extracts path-candidate tokens from a bash command using tree-sitter with
 * the broader filter (accepts dot-files, relative paths). Evaluates each
 * token against the `path` permission surface and returns the most
 * restrictive result.
 *
 * Returns `null` when the gate does not apply (tool is not bash, no command,
 * no tokens extracted, or all tokens evaluate to `allow`).
 * Returns a `GateBypass` when all tokens are session-covered.
 * Returns a `GateDescriptor` for the most restrictive token needing a check.
 */
export async function describeBashPathGate(
  tcc: ToolCallContext,
  checkPermission: CheckPermissionFn,
  getSessionRuleset: () => Rule[],
): Promise<GateResult> {
  if (tcc.toolName !== "bash") return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;

  const tokens = await extractTokensForPathRules(command);
  if (tokens.length === 0) return null;

  // Check each token against path rules with session rules appended.
  const sessionRules = getSessionRuleset();

  let worstCheck: PermissionCheckResult | null = null;
  let worstToken: string | null = null;
  let allSessionCovered = true;

  for (const token of tokens) {
    const check = checkPermission(
      "path",
      { path: token },
      tcc.agentName ?? undefined,
      sessionRules,
    );

    // No explicit path rule matched — only the universal default fired.
    // Treat this token as unrestricted to preserve backward compatibility
    // for configs without a "path" key (#58).
    if (check.matchedPattern === undefined && check.source !== "session") {
      allSessionCovered = false;
      continue;
    }

    if (check.source !== "session") {
      allSessionCovered = false;
    }

    if (check.state === "deny") {
      worstCheck = check;
      worstToken = token;
      break; // Short-circuit on deny.
    }
    if (check.state === "ask" && worstCheck?.state !== "ask") {
      worstCheck = check;
      worstToken = token;
    }
  }

  // All tokens are session-covered — bypass.
  if (allSessionCovered) {
    return {
      action: "allow",
      log: {
        event: "permission_request.session_approved",
        details: {
          source: "tool_call",
          toolCallId: tcc.toolCallId,
          toolName: tcc.toolName,
          agentName: tcc.agentName,
          command,
          tokens,
          resolution: "session_approved",
        },
      },
    };
  }

  // All tokens evaluate to allow — no restriction.
  if (!worstCheck || !worstToken) return null;

  const pattern = deriveApprovalPattern(worstToken);
  const askMessage = formatPathAskPrompt(tcc.toolName, worstToken, tcc.agentName ?? undefined);

  return {
    surface: "path",
    input: { path: worstToken },
    denialContext: {
      kind: "bash_path",
      command,
      pathValue: worstToken,
      agentName: tcc.agentName ?? undefined,
    },
    sessionApproval: {
      surface: "path",
      pattern,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: askMessage,
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      command,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      command,
      path: worstToken,
    },
    decision: {
      surface: "path",
      value: worstToken,
    },
    preCheck: worstCheck,
  };
}

import { getNonEmptyString, toRecord } from "#src/common";
import type { Rule } from "#src/rule";
import { deriveApprovalPattern } from "#src/session-rules";
import type { PermissionCheckResult } from "#src/types";
import { extractExternalPathsFromBashCommand } from "./bash-path-extractor";
import type { GateResult } from "./descriptor";
import { formatBashExternalDirectoryAskPrompt } from "./external-directory-messages";
import type { ToolCallContext } from "./types";

/** Function type for checkPermission used by the descriptor factory. */
type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Rule[],
) => PermissionCheckResult;

/**
 * Build a pure descriptor for the bash external-directory permission gate.
 *
 * Extracts paths from a bash command and checks whether any reference
 * directories outside the working directory. Returns `null` when the gate
 * does not apply (tool is not bash, no CWD, or no external paths found).
 * Returns a `GateBypass` when all paths are allowed (by config or session rule).
 * Returns a `GateDescriptor` with multi-pattern sessionApproval for uncovered paths.
 */
export async function describeBashExternalDirectoryGate(
  tcc: ToolCallContext,
  checkPermission: CheckPermissionFn,
  getSessionRuleset: () => Rule[],
): Promise<GateResult> {
  if (tcc.toolName !== "bash" || !tcc.cwd) return null;

  const command = getNonEmptyString(toRecord(tcc.input).command);
  if (!command) return null;

  const externalPaths = await extractExternalPathsFromBashCommand(command, tcc.cwd);
  if (externalPaths.length === 0) return null;

  const bashSessionRules = getSessionRuleset();

  // Collect paths whose resolved state is not already "allow".
  // Checking state (not source) ensures config-level allow rules (source: "special")
  // suppress the prompt just as session-level allow rules (source: "session") do.
  const uncoveredEntries: Array<{
    path: string;
    check: PermissionCheckResult;
  }> = [];
  for (const p of externalPaths) {
    const check = checkPermission(
      "external_directory",
      { path: p },
      tcc.agentName ?? undefined,
      bashSessionRules,
    );
    if (check.state !== "allow") {
      uncoveredEntries.push({ path: p, check });
    }
  }
  const uncoveredPaths = uncoveredEntries.map(({ path }) => path);

  if (uncoveredPaths.length === 0) {
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
          externalPaths,
          resolution: "session_approved",
        },
      },
    };
  }

  // Use the most restrictive check among uncovered paths as the pre-check result.
  // This ensures a config-level "deny" rule is not downgraded to "ask" by the
  // generic "*" catch-all that the old path-less checkPermission call returned.
  const worstCheck =
    uncoveredEntries.find(({ check }) => check.state === "deny")?.check ??
    uncoveredEntries[0].check;

  const bashExtMessage = formatBashExternalDirectoryAskPrompt(
    command,
    uncoveredPaths,
    tcc.cwd,
    tcc.agentName ?? undefined,
  );

  const patterns = uncoveredPaths.map((p) => deriveApprovalPattern(p));

  return {
    surface: "external_directory",
    input: {},
    denialContext: {
      kind: "bash_external_directory",
      command,
      externalPaths: uncoveredPaths,
      cwd: tcc.cwd,
      agentName: tcc.agentName ?? undefined,
    },
    sessionApproval: {
      surface: "external_directory",
      patterns,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: bashExtMessage,
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
      externalPaths: uncoveredPaths,
      message: bashExtMessage,
    },
    decision: {
      surface: "external_directory",
      value: command,
    },
    preCheck: worstCheck,
  };
}

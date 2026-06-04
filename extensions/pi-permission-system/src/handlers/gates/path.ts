import { getPathBearingToolPath } from "#src/path-utils";
import type { Rule } from "#src/rule";
import { deriveApprovalPattern } from "#src/session-rules";
import type { PermissionCheckResult } from "#src/types";
import type { GateDescriptor, GateResult } from "./descriptor";
import type { ToolCallContext } from "./types";

/** Function type for checkPermission used by the descriptor factory. */
type CheckPermissionFn = (
  surface: string,
  input: unknown,
  agentName?: string,
  sessionRules?: Rule[],
) => PermissionCheckResult;

/**
 * Build a pure descriptor for the cross-cutting path permission gate (tools).
 *
 * Returns `null` when the gate does not apply (tool is not path-bearing,
 * no extractable path, the `path` surface evaluates to `allow`, or no
 * explicit `path` rule matched — i.e. only the universal default fired).
 * Returns a `GateDescriptor` when the path matches a `deny` or `ask` rule.
 */
export function describePathGate(
  tcc: ToolCallContext,
  checkPermission: CheckPermissionFn,
  getSessionRuleset: () => Rule[],
): GateResult {
  const filePath = getPathBearingToolPath(tcc.toolName, tcc.input);
  if (!filePath) return null;

  const sessionRules = getSessionRuleset();
  const check = checkPermission(
    "path",
    { path: filePath },
    tcc.agentName ?? undefined,
    sessionRules,
  );

  if (check.state === "allow") return null;

  // No explicit path rule matched — only the universal default fired.
  // Skip the gate to preserve backward compatibility: configs without a
  // "path" key should not trigger path-level prompts (#58).
  if (check.matchedPattern === undefined) return null;

  const pattern = deriveApprovalPattern(filePath);

  const descriptor: GateDescriptor = {
    surface: "path",
    input: { path: filePath },
    denialContext: {
      kind: "path",
      toolName: tcc.toolName,
      pathValue: filePath,
      agentName: tcc.agentName ?? undefined,
    },
    sessionApproval: {
      surface: "path",
      pattern,
    },
    promptDetails: {
      source: "tool_call",
      agentName: tcc.agentName,
      message: formatPathAskPrompt(tcc.toolName, filePath, tcc.agentName ?? undefined),
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      path: filePath,
    },
    logContext: {
      source: "tool_call",
      toolCallId: tcc.toolCallId,
      toolName: tcc.toolName,
      agentName: tcc.agentName,
      path: filePath,
    },
    decision: {
      surface: "path",
      value: filePath,
    },
    preCheck: check,
  };

  return descriptor;
}

export function formatPathAskPrompt(
  toolName: string,
  pathValue: string,
  agentName?: string,
): string {
  const subject = agentName ? `Agent '${agentName}'` : "Current agent";
  return `${subject} requested tool '${toolName}' for path '${pathValue}'. Allow this path access?`;
}

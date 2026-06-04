import type { PermissionDecisionResolution } from "#src/permission-events";
import type { PermissionCheckResult } from "#src/types";

/**
 * Derive the human-readable value for a decision event from a check result.
 * Bash → extracted command; MCP → qualified target;
 * path-bearing tools → file path; others → tool name.
 */
export function deriveDecisionValue(
  toolName: string,
  check: Pick<PermissionCheckResult, "command" | "target">,
  path?: string,
): string {
  if (toolName === "bash") return check.command ?? toolName;
  if (toolName === "mcp") return check.target ?? toolName;
  if (path) return path;
  return toolName;
}

/**
 * Map the gate outcome back to a PermissionDecisionResolution.
 *
 * @param state     - The permission state passed to the gate.
 * @param action    - The gate's resulting action ("allow" | "block").
 * @param hasSession - True when the gate result carries a sessionApproval
 *                    (indicates the user chose "for this session").
 * @param canConfirm - Whether an interactive prompt was available.
 */
export function deriveResolution(
  state: "allow" | "deny" | "ask",
  action: "allow" | "block",
  hasSession: boolean,
  canConfirm: boolean,
  autoApproved = false,
): PermissionDecisionResolution {
  if (state === "allow") return "policy_allow";
  if (state === "deny") return "policy_deny";
  // state === "ask"
  if (action === "allow") {
    if (autoApproved) return "auto_approved";
    return hasSession ? "user_approved_for_session" : "user_approved";
  }
  return canConfirm ? "user_denied" : "confirmation_unavailable";
}

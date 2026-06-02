import type { PolicyResult } from "./policy";

export type ApprovalDecision =
  | { readonly kind: "allow"; readonly reason?: string }
  | { readonly kind: "block"; readonly reason: string };

export interface AutoApprover {
  readonly name: string;
  approve(toolName: string, policy: PolicyResult): ApprovalDecision | Promise<ApprovalDecision>;
}

export class RuleBasedApprover implements AutoApprover {
  readonly name = "rule-based";

  approve(_toolName: string, policy: PolicyResult): ApprovalDecision {
    if (policy.tier === "T4" || policy.tier === "T3") {
      return { kind: "block", reason: policy.reason };
    }

    if (policy.isAutoAllowable) {
      return { kind: "allow", reason: policy.reason };
    }

    // Protected paths and unrecognized commands are treated as block
    // because Pi tool_call does not support interactive "ask" suspension.
    return { kind: "block", reason: policy.reason };
  }
}

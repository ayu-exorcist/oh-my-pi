import type { AutoApprover, ApprovalDecision } from "./approver";
import type { PolicyResult } from "./policy";
import { RuleBasedApprover } from "./approver";

export interface ClassifierInput {
  readonly toolName: string;
  readonly command?: string;
  readonly path?: string;
  readonly context?: string;
}

export interface ClassifierResult {
  readonly risk: number;
  readonly reason: string;
}

export interface RiskClassifier {
  classify(input: ClassifierInput): Promise<ClassifierResult>;
}

// Placeholder that always rejects so the fallback path is exercised.
export class UnconfiguredClassifier implements RiskClassifier {
  async classify(_input: ClassifierInput): Promise<ClassifierResult> {
    throw new Error("No classifier configured; falling back to rule-based approver");
  }
}

export class ClassifierApprover implements AutoApprover {
  readonly name = "classifier";

  private readonly classifier: RiskClassifier;

  private readonly fallback: AutoApprover;

  private readonly highThreshold: number;

  constructor(options?: {
    classifier?: RiskClassifier;
    fallback?: AutoApprover;
    highThreshold?: number;
  }) {
    this.classifier = options?.classifier ?? new UnconfiguredClassifier();
    this.fallback = options?.fallback ?? new RuleBasedApprover();
    this.highThreshold = options?.highThreshold ?? 0.7;
  }

  async approve(toolName: string, policy: PolicyResult): Promise<ApprovalDecision> {
    // Hard safety rules always take precedence regardless of classifier opinion.
    if (policy.tier === "T4" || policy.tier === "T3") {
      return { kind: "block", reason: policy.reason };
    }

    try {
      const result = await this.classifier.classify({
        toolName,
        context: policy.reason,
      });

      if (result.risk >= this.highThreshold) {
        return { kind: "block", reason: `Classifier: ${result.reason}` };
      }

      if (result.risk <= 0.3) {
        return { kind: "allow", reason: `Classifier: ${result.reason}` };
      }

      // Uncertain region → delegate to fallback for a deterministic answer.
      return this.fallback.approve(toolName, policy);
    } catch {
      // Classifier unavailable → silently fall back to rule-based.
      return this.fallback.approve(toolName, policy);
    }
  }
}

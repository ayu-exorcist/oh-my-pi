import { describe, expect, test } from "vitest";
import { ClassifierApprover, UnconfiguredClassifier } from "./classifier";
import { RuleBasedApprover } from "./approver";
import type { PolicyResult } from "./policy";

function makePolicy(overrides?: Partial<PolicyResult>): PolicyResult {
  return {
    tier: "T1",
    isProtectedPath: false,
    isAutoAllowable: true,
    reason: "test",
    ...overrides,
  };
}

describe("ClassifierApprover", () => {
  test("falls back to rule-based when classifier is unconfigured", async () => {
    const approver = new ClassifierApprover({});
    const policy = makePolicy();

    const decision = await approver.approve("write", policy);
    expect(decision.kind).toBe("allow");
  });

  test("blocks T4 regardless of classifier opinion", async () => {
    const approver = new ClassifierApprover({});
    const policy = makePolicy({ tier: "T4", isAutoAllowable: false, reason: "Blocked T4" });

    const decision = await approver.approve("bash", policy);
    expect(decision.kind).toBe("block");
    expect(decision.reason).toContain("T4");
  });

  test("blocks T3 regardless of classifier opinion", async () => {
    const approver = new ClassifierApprover({});
    const policy = makePolicy({ tier: "T3", isAutoAllowable: false, reason: "Blocked T3" });

    const decision = await approver.approve("bash", policy);
    expect(decision.kind).toBe("block");
    expect(decision.reason).toContain("T3");
  });

  test("allows low-risk classifier results", async () => {
    const mockClassifier = {
      async classify() {
        return { risk: 0.1, reason: "safe" };
      },
    };

    const approver = new ClassifierApprover({ classifier: mockClassifier });
    const policy = makePolicy();

    const decision = await approver.approve("write", policy);
    expect(decision.kind).toBe("allow");
    expect(decision.reason).toContain("Classifier");
  });

  test("blocks high-risk classifier results", async () => {
    const mockClassifier = {
      async classify() {
        return { risk: 0.9, reason: "dangerous" };
      },
    };

    const approver = new ClassifierApprover({ classifier: mockClassifier });
    const policy = makePolicy();

    const decision = await approver.approve("bash", policy);
    expect(decision.kind).toBe("block");
    expect(decision.reason).toContain("Classifier");
  });

  test("delegates to fallback in uncertain region", async () => {
    const mockClassifier = {
      async classify() {
        return { risk: 0.5, reason: "uncertain" };
      },
    };

    const fallback = new RuleBasedApprover();
    const approver = new ClassifierApprover({ classifier: mockClassifier, fallback });
    const policy = makePolicy({ isAutoAllowable: false });

    const decision = await approver.approve("unknown_tool", policy);
    expect(decision.kind).toBe("block");
  });

  test("falls back when classifier throws", async () => {
    const mockClassifier = {
      async classify() {
        throw new Error("classifier down");
      },
    };

    const approver = new ClassifierApprover({ classifier: mockClassifier });
    const policy = makePolicy();

    const decision = await approver.approve("write", policy);
    expect(decision.kind).toBe("allow");
  });

  test("uses custom high threshold", async () => {
    const mockClassifier = {
      async classify() {
        return { risk: 0.6, reason: "medium" };
      },
    };

    const approver = new ClassifierApprover({
      classifier: mockClassifier,
      highThreshold: 0.8,
    });
    const policy = makePolicy();

    // 0.6 < 0.8, not high, and > 0.3, so it falls back to rule-based
    const decision = await approver.approve("write", policy);
    expect(decision.kind).toBe("allow");
  });
});

describe("RuleBasedApprover", () => {
  test("blocks T4 policies", () => {
    const approver = new RuleBasedApprover();
    const decision = approver.approve(
      "bash",
      makePolicy({ tier: "T4", isAutoAllowable: false, reason: "Blocked T4" }),
    );
    expect(decision.kind).toBe("block");
    expect(decision.reason).toContain("Blocked T4");
  });

  test("blocks T3 policies", () => {
    const approver = new RuleBasedApprover();
    const decision = approver.approve(
      "bash",
      makePolicy({ tier: "T3", isAutoAllowable: false, reason: "Blocked T3" }),
    );
    expect(decision.kind).toBe("block");
    expect(decision.reason).toContain("Blocked T3");
  });
});

describe("UnconfiguredClassifier", () => {
  test("always rejects", async () => {
    const classifier = new UnconfiguredClassifier();
    await expect(classifier.classify({ toolName: "write" })).rejects.toThrow(
      "No classifier configured",
    );
  });
});

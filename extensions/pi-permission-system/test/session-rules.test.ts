import { describe, expect, it } from "vitest";

import { evaluate } from "#src/rule";
import { deriveApprovalPattern, SessionRules } from "#src/session-rules";

// ── SessionRules ───────────────────────────────────────────────────────────

describe("SessionRules", () => {
  describe("getRuleset", () => {
    it("returns an empty ruleset initially", () => {
      const rules = new SessionRules();
      expect(rules.getRuleset()).toEqual([]);
    });

    it("returns a ruleset containing approved rules", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/other/project/*");
      expect(rules.getRuleset()).toEqual([
        {
          surface: "external_directory",
          pattern: "/other/project/*",
          action: "allow",
          layer: "session",
          origin: "session",
        },
      ]);
    });

    it("returns a defensive copy — mutations do not affect internal state", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/other/project/*");
      const copy = rules.getRuleset();
      copy.push({
        surface: "bash",
        pattern: "*",
        action: "deny",
        origin: "session",
      });
      expect(rules.getRuleset()).toHaveLength(1);
    });

    it("accumulates multiple approved patterns", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/project-a/*");
      rules.approve("external_directory", "/project-b/*");
      expect(rules.getRuleset()).toHaveLength(2);
    });
  });

  describe("clear", () => {
    it("removes all session rules", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/other/project/*");
      rules.approve("external_directory", "/another/path/*");
      rules.clear();
      expect(rules.getRuleset()).toEqual([]);
    });

    it("allows new approvals after clearing", () => {
      const rules = new SessionRules();
      rules.approve("external_directory", "/old/path/*");
      rules.clear();
      rules.approve("external_directory", "/new/path/*");
      expect(rules.getRuleset()).toHaveLength(1);
      expect(rules.getRuleset()[0].pattern).toBe("/new/path/*");
    });
  });

  describe("evaluate() integration", () => {
    it("returns allow for a path under an approved directory", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/other/project/*");
      const result = evaluate(
        "external_directory",
        "/other/project/src/foo.ts",
        session.getRuleset(),
      );
      expect(result.action).toBe("allow");
    });

    it("returns ask (default) for a path outside approved directories", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/other/project/*");
      const result = evaluate(
        "external_directory",
        "/other/unrelated/file.ts",
        session.getRuleset(),
      );
      // No rule matches — evaluate returns synthetic rule with default action "ask"
      expect(result.action).toBe("ask");
    });

    it("does not match a sibling directory that shares a string prefix", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/other/project/*");
      const result = evaluate(
        "external_directory",
        "/other/project-b/foo.ts",
        session.getRuleset(),
      );
      expect(result.action).toBe("ask");
    });

    it("matches the directory itself (trailing slash)", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/other/project/src/*");
      // The * in wildcardMatch maps to .* which matches zero chars — so /src/ is covered.
      const result = evaluate("external_directory", "/other/project/src/", session.getRuleset());
      expect(result.action).toBe("allow");
    });

    it("handles multiple approved directories", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/project-a/*");
      session.approve("external_directory", "/project-b/*");
      expect(evaluate("external_directory", "/project-a/foo.ts", session.getRuleset()).action).toBe(
        "allow",
      );
      expect(evaluate("external_directory", "/project-b/bar.ts", session.getRuleset()).action).toBe(
        "allow",
      );
      expect(evaluate("external_directory", "/project-c/baz.ts", session.getRuleset()).action).toBe(
        "ask",
      );
    });

    it("does not match a different surface", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/other/project/*");
      const result = evaluate("bash", "/other/project/foo.ts", session.getRuleset());
      expect(result.action).toBe("ask");
    });

    it("returns allow after clearing and re-approving", () => {
      const session = new SessionRules();
      session.approve("external_directory", "/old/project/*");
      session.clear();
      session.approve("external_directory", "/new/project/*");
      expect(
        evaluate("external_directory", "/old/project/file.ts", session.getRuleset()).action,
      ).toBe("ask");
      expect(
        evaluate("external_directory", "/new/project/file.ts", session.getRuleset()).action,
      ).toBe("allow");
    });
  });
});

// ── deriveApprovalPattern ──────────────────────────────────────────────────

describe("deriveApprovalPattern", () => {
  it("returns parent directory glob for a file path", () => {
    expect(deriveApprovalPattern("/other/project/src/foo.ts")).toBe("/other/project/src/*");
  });

  it("returns directory glob when path already ends with separator", () => {
    expect(deriveApprovalPattern("/other/project/src/")).toBe("/other/project/src/*");
  });

  it("returns parent directory glob for a directory-like path without trailing separator", () => {
    // Cannot distinguish dir from file — dirname is the safe choice
    expect(deriveApprovalPattern("/other/project/src")).toBe("/other/project/*");
  });

  it("handles root path", () => {
    expect(deriveApprovalPattern("/")).toBe("/*");
  });

  it("handles a path whose dirname is itself", () => {
    expect(deriveApprovalPattern(".")).toBe(".*");
  });

  it("handles single-level path", () => {
    expect(deriveApprovalPattern("/foo")).toBe("/*");
  });

  it("produces a pattern that matches paths under the approved directory", () => {
    const pattern = deriveApprovalPattern("/other/project/src/foo.ts");
    const session = new SessionRules();
    session.approve("external_directory", pattern);
    expect(
      evaluate("external_directory", "/other/project/src/bar.ts", session.getRuleset()).action,
    ).toBe("allow");
  });

  it("produces a pattern that does not match sibling directories", () => {
    const pattern = deriveApprovalPattern("/other/project/src/foo.ts");
    const session = new SessionRules();
    session.approve("external_directory", pattern);
    expect(
      evaluate("external_directory", "/other/project/lib/bar.ts", session.getRuleset()).action,
    ).toBe("ask");
  });
});

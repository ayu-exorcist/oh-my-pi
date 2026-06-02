import { describe, expect, test, vi } from "vitest";
import { isStringArray, isValidAllowlist, loadGateSettings } from "./settings";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  };
});

import { readFile } from "node:fs/promises";

describe("settings loader", () => {
  test("isStringArray validates string arrays", () => {
    expect(isStringArray(["a", "b"])).toBe(true);
    expect(isStringArray([])).toBe(true);
    expect(isStringArray([1, 2])).toBe(false);
    expect(isStringArray("string")).toBe(false);
    expect(isStringArray(null)).toBe(false);
  });

  test("isValidAllowlist validates allowlist shape", () => {
    expect(isValidAllowlist({ bash: ["git status"], tools: ["write"] })).toBe(true);
    expect(isValidAllowlist({ bash: ["git status"] })).toBe(true);
    expect(isValidAllowlist({ tools: ["write"] })).toBe(true);
    expect(isValidAllowlist({})).toBe(true);
    expect(isValidAllowlist({ bash: "not-array" })).toBe(false);
    expect(isValidAllowlist({ tools: 123 })).toBe(false);
    expect(isValidAllowlist("string")).toBe(false);
  });

  test("loads all gate settings from settings.json", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          riskRules: [{ pattern: "git push", tier: "T4" }],
          protectedPaths: [".env.production", "secrets/"],
          allowlist: {
            bash: ["pnpm run check", "pnpm run build"],
            tools: ["write", "edit"],
          },
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings).toBeDefined();
    expect(settings?.riskRules).toEqual([{ pattern: "git push", tier: "T4" }]);
    expect(settings?.protectedPaths).toEqual([".env.production", "secrets/"]);
    expect(settings?.allowlist).toEqual({
      bash: ["pnpm run check", "pnpm run build"],
      tools: ["write", "edit"],
    });
  });

  test("returns undefined when no writeGate config exists", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ otherKey: true }));

    const settings = await loadGateSettings("/test/project");
    expect(settings).toBeUndefined();
  });

  test("handles malformed JSON gracefully", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));

    const settings = await loadGateSettings("/test/project");
    expect(settings).toBeUndefined();
  });

  test("skips invalid risk rules", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          riskRules: [
            { pattern: "git push", tier: "T4" },
            { pattern: "bad", tier: "TX" },
            "not-a-rule",
          ],
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings?.riskRules).toEqual([{ pattern: "git push", tier: "T4" }]);
  });

  test("skips empty or invalid allowlist", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          allowlist: { bash: "not-array" },
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings?.allowlist).toBeUndefined();
  });

  test("skips empty protectedPaths", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          protectedPaths: [],
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings?.protectedPaths).toBeUndefined();
  });

  test("returns undefined when cwd is empty", async () => {
    const settings = await loadGateSettings("");
    expect(settings).toBeUndefined();
  });

  test("loads classifier approver setting", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          approver: "classifier",
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings?.approver).toBe("classifier");
  });

  test("loads rule-based approver setting", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          approver: "rule-based",
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings?.approver).toBe("rule-based");
  });

  test("skips invalid approver values", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        writeGate: {
          approver: "invalid",
        },
      }),
    );

    const settings = await loadGateSettings("/test/project");
    expect(settings).toBeUndefined();
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";

const execFileSync = vi.hoisted(() =>
  vi.fn((command: string, args: readonly string[]) => {
    if (command === "git" && args[0] === "diff") return "a.ts\n" as never;
    return undefined as never;
  }),
);

vi.mock("node:child_process", () => ({
  execFileSync,
}));

describe("pre-commit script", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileSync.mockClear();
  });

  test("runs format, lint fix, restage, and check", async () => {
    await import("./pre-commit");

    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
      {
        encoding: "utf8",
      },
    );
    expect(execFileSync).toHaveBeenCalledWith("pnpm", ["run", "fmt"], { stdio: "inherit" });
    expect(execFileSync).toHaveBeenCalledWith("pnpm", ["run", "lint:fix"], { stdio: "inherit" });
    expect(execFileSync).toHaveBeenCalledWith("git", ["add", "--", "a.ts"], { stdio: "inherit" });
    expect(execFileSync).toHaveBeenCalledWith("pnpm", ["run", "check"], { stdio: "inherit" });
  });

  test("skips restaging when nothing changed", async () => {
    execFileSync.mockImplementation(((command: string, args: readonly string[]) => {
      if (command === "git" && args[0] === "diff") return "\n" as never;
      return undefined as never;
    }) as never);

    await import("./pre-commit");

    expect(execFileSync).not.toHaveBeenCalledWith("git", ["add", "--", "a.ts"], {
      stdio: "inherit",
    });
  });
});

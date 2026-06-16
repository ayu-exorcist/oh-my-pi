import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./lib/select-release-tags", () => ({
  parseLocalTagList: vi.fn(() => ["tag-a"]),
  parseRemoteTagList: vi.fn(() => []),
  selectReleaseTagsToPush: vi.fn(() => ["tag-a"]),
}));

import { execFileSync as mockedExecFileSync } from "node:child_process";
import {
  parseLocalTagList as mockedParseLocalTagList,
  parseRemoteTagList as mockedParseRemoteTagList,
  selectReleaseTagsToPush as mockedSelectReleaseTagsToPush,
} from "./lib/select-release-tags";

// Defer the static import so the entrypoint test can set process.argv[1] first.
const { syncReleaseTags: _syncReleaseTags } = await import("./sync-release-tags");

const mockExecFileSync = vi.mocked(mockedExecFileSync);
const mockParseLocalTagList = vi.mocked(mockedParseLocalTagList);
const mockParseRemoteTagList = vi.mocked(mockedParseRemoteTagList);
const mockSelectReleaseTagsToPush = vi.mocked(mockedSelectReleaseTagsToPush);

// Assign after all modules are loaded so tests can call it normally.
let syncReleaseTags: typeof _syncReleaseTags;

describe("sync release tags", { retry: 2 }, () => {
  beforeEach(() => {
    mockExecFileSync.mockImplementation(((command: string) => {
      if (command === "git") return "tag-a\n" as never;
      return undefined as never;
    }) as never);
    // After resetModules, re-resolve the lazy import for normal tests
    syncReleaseTags = _syncReleaseTags;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("pushes selected tags", () => {
    syncReleaseTags();

    expect(mockParseLocalTagList).toHaveBeenCalled();
    expect(mockParseRemoteTagList).toHaveBeenCalled();
    expect(mockSelectReleaseTagsToPush).toHaveBeenCalledWith(["tag-a"], []);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["push", "--no-verify", "origin", "tag-a"],
      {
        stdio: "inherit",
      },
    );
  });

  test("runs the entrypoint when imported as a script", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const tagsEntry = fileURLToPath(new URL("./sync-release-tags.ts", import.meta.url));
    const previousArgv1 = process.argv[1] ?? "";
    process.argv[1] = tagsEntry;

    try {
      vi.resetModules();
      // Re-apply mocks after resetModules
      vi.doMock("node:child_process", () => ({
        execFileSync: vi.fn() as never,
      }));
      vi.doMock("./lib/select-release-tags", () => ({
        parseLocalTagList: vi.fn(() => ["tag-b"]),
        parseRemoteTagList: vi.fn(() => []),
        selectReleaseTagsToPush: vi.fn(() => ["tag-b"]),
      }));
      await import("./sync-release-tags");
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      process.argv[1] = previousArgv1;
      exitSpy.mockRestore();
      // Re-resolve for subsequent tests
      const mod = await import("./sync-release-tags");
      syncReleaseTags = mod.syncReleaseTags;
    }
  });

  test("fails when no release tags were created", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    mockSelectReleaseTagsToPush.mockReturnValueOnce([]);

    syncReleaseTags();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

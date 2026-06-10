import { execSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { getNpmUser, getRegistryVersion, setRoot } from "./npm";

const mockExecSync = vi.mocked(execSync);

describe("npm registry helpers", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    setRoot("/repo");
  });

  test("returns trimmed registry versions", () => {
    mockExecSync.mockReturnValue("1.2.3\n" as never);

    expect(getRegistryVersion("pkg")).toBe("1.2.3");
    expect(mockExecSync).toHaveBeenCalledWith("npm view pkg version", {
      encoding: "utf8",
      cwd: "/repo",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  test("returns null when npm view fails", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("offline");
    });

    expect(getRegistryVersion("pkg")).toBeNull();
  });

  test("returns the authenticated npm user", () => {
    mockExecSync.mockReturnValue("ayu.exorcist\n" as never);

    expect(getNpmUser()).toBe("ayu.exorcist");
    expect(mockExecSync).toHaveBeenCalledWith("pnpm whoami", {
      encoding: "utf8",
      cwd: "/repo",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  });

  test("returns null when npm auth is missing", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("unauthorized");
    });

    expect(getNpmUser()).toBeNull();
  });

  test("returns null for empty npm whoami output", () => {
    mockExecSync.mockReturnValue("\n" as never);

    expect(getNpmUser()).toBeNull();
  });
});

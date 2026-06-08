import { execSync } from "node:child_process";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { getRegistryVersion, setRoot } from "./npm";

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
});

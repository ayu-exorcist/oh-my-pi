import { basename, join, posix } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getAyuAgentDir,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalLogsDir,
  getLegacyExtensionConfigPath,
  getLegacyGlobalConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectAgentsDir,
  getLegacyProjectConfigPath,
  getLegacyProjectPolicyPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  joinPathLike,
} from "#src/config-paths";

describe("config-paths", () => {
  it("joins posix-style paths with posix join", () => {
    expect(joinPathLike("/base", "foo", "bar")).toBe("/base/foo/bar");
  });

  it("joins non-posix base paths with node:path.join", () => {
    const base = "C:\\base";
    expect(joinPathLike(base, "foo", "bar")).toBe(join(base, "foo", "bar"));
  });

  it("returns the ayu directory unchanged when already suffixed", () => {
    expect(getAyuAgentDir("/home/user/ayu")).toBe("/home/user/ayu");
  });

  it("appends ayu when missing", () => {
    expect(getAyuAgentDir("/home/user")).toBe("/home/user/ayu");
  });

  it("builds the global config and log paths under the ayu directory", () => {
    const agentDir = "/home/user";
    expect(getGlobalConfigDir(agentDir)).toBe(
      posix.join(agentDir, "ayu", "extensions", "pi-permission-system"),
    );
    expect(getGlobalConfigPath(agentDir)).toBe(
      posix.join(agentDir, "ayu", "extensions", "pi-permission-system", "config.json"),
    );
    expect(getGlobalLogsDir(agentDir)).toBe(
      posix.join(agentDir, "ayu", "extensions", "pi-permission-system", "logs"),
    );
  });

  it("builds the project paths under .pi/ayu", () => {
    const cwd = "/workspace/project";
    expect(getProjectConfigPath(cwd)).toBe(
      posix.join(cwd, ".pi", "ayu", "extensions", "pi-permission-system", "config.json"),
    );
    expect(getProjectAgentsDir(cwd)).toBe(posix.join(cwd, ".pi", "ayu", "agents"));
  });

  it("builds the legacy paths used for migration compatibility", () => {
    const base = "/workspace/project";
    expect(getLegacyGlobalConfigPath(base)).toBe(
      posix.join(base, "extensions", "pi-permission-system", "config.json"),
    );
    expect(getLegacyGlobalPolicyPath(base)).toBe(posix.join(base, "pi-permissions.jsonc"));
    expect(getLegacyProjectConfigPath(base)).toBe(
      posix.join(base, ".pi", "extensions", "pi-permission-system", "config.json"),
    );
    expect(getLegacyProjectPolicyPath(base)).toBe(
      posix.join(base, ".pi", "agent", "pi-permissions.jsonc"),
    );
    expect(getLegacyProjectAgentsDir(base)).toBe(posix.join(base, ".pi", "agent", "agents"));
  });

  it("returns legacy extension config paths relative to the provided root", () => {
    expect(getLegacyExtensionConfigPath("/repo/extensions/pi-permission-system")).toBe(
      posix.join("/repo/extensions/pi-permission-system", "config.json"),
    );
  });

  it("uses the basename helper only for ayu directory detection", () => {
    expect(basename(getAyuAgentDir("/tmp/ayu"))).toBe("ayu");
  });
});

import { posix } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEBUG_LOG_FILENAME,
  getAyuAgentDir,
  getGlobalConfigDir,
  getGlobalConfigPath,
  getGlobalLogsDir,
  getLegacyExtensionConfigPath,
  getLegacyGlobalConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectConfigPath,
  getLegacyProjectPolicyPath,
  getProjectAgentsDir,
  getProjectConfigPath,
  REVIEW_LOG_FILENAME,
} from "#src/config-paths";

describe("config-paths", () => {
  const agentDir = "/home/user/.pi/agent";
  const ayuAgentDir = posix.join(agentDir, "ayu");
  const cwd = "/projects/my-app";
  const extensionRoot = "/opt/extensions/pi-permission-system";

  describe("new layout paths", () => {
    it("getAyuAgentDir appends ayu when agentDir is the generic agent root", () => {
      expect(getAyuAgentDir(agentDir)).toBe(ayuAgentDir);
    });

    it("getAyuAgentDir does not append ayu twice", () => {
      expect(getAyuAgentDir(ayuAgentDir)).toBe(ayuAgentDir);
    });

    it("getGlobalConfigDir returns extensions/pi-permission-system under the Ayu agent dir", () => {
      expect(getGlobalConfigDir(agentDir)).toBe(
        posix.join(ayuAgentDir, "extensions", "pi-permission-system"),
      );
    });

    it("getGlobalConfigPath returns config.json under the global config dir", () => {
      expect(getGlobalConfigPath(agentDir)).toBe(
        posix.join(ayuAgentDir, "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getGlobalLogsDir returns logs under the global config dir", () => {
      expect(getGlobalLogsDir(agentDir)).toBe(
        posix.join(ayuAgentDir, "extensions", "pi-permission-system", "logs"),
      );
    });

    it("getProjectConfigPath returns .pi/ayu/extensions/pi-permission-system/config.json under cwd", () => {
      expect(getProjectConfigPath(cwd)).toBe(
        posix.join(cwd, ".pi", "ayu", "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getProjectAgentsDir returns .pi/ayu/agents under cwd", () => {
      expect(getProjectAgentsDir(cwd)).toBe(posix.join(cwd, ".pi", "ayu", "agents"));
    });
  });

  describe("legacy paths", () => {
    it("getLegacyGlobalConfigPath returns the pre-Ayu global extension config path", () => {
      expect(getLegacyGlobalConfigPath(agentDir)).toBe(
        posix.join(agentDir, "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getLegacyGlobalPolicyPath returns pi-permissions.jsonc under agentDir", () => {
      expect(getLegacyGlobalPolicyPath(agentDir)).toBe(
        posix.join(agentDir, "pi-permissions.jsonc"),
      );
    });

    it("getLegacyProjectConfigPath returns .pi/extensions/pi-permission-system/config.json under cwd", () => {
      expect(getLegacyProjectConfigPath(cwd)).toBe(
        posix.join(cwd, ".pi", "extensions", "pi-permission-system", "config.json"),
      );
    });

    it("getLegacyProjectPolicyPath returns .pi/agent/pi-permissions.jsonc under cwd", () => {
      expect(getLegacyProjectPolicyPath(cwd)).toBe(
        posix.join(cwd, ".pi", "agent", "pi-permissions.jsonc"),
      );
    });

    it("getLegacyExtensionConfigPath returns config.json under extensionRoot", () => {
      expect(getLegacyExtensionConfigPath(extensionRoot)).toBe(
        posix.join(extensionRoot, "config.json"),
      );
    });
  });

  describe("log filenames", () => {
    it("DEBUG_LOG_FILENAME is a .jsonl file", () => {
      expect(DEBUG_LOG_FILENAME).toBe("pi-permission-system-debug.jsonl");
    });

    it("REVIEW_LOG_FILENAME is a .jsonl file", () => {
      expect(REVIEW_LOG_FILENAME).toBe("pi-permission-system-permission-review.jsonl");
    });
  });
});

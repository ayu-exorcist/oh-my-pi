import { posix } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDiscoverGlobalNodeModulesRoot } = vi.hoisted(() => ({
  mockDiscoverGlobalNodeModulesRoot: vi.fn<() => string | null>(),
}));

vi.mock("../src/node-modules-discovery", () => ({
  discoverGlobalNodeModulesRoot: mockDiscoverGlobalNodeModulesRoot,
}));

import { getGlobalLogsDir } from "#src/config-paths";
import { computeExtensionPaths } from "#src/extension-paths";

describe("computeExtensionPaths", () => {
  beforeEach(() => {
    mockDiscoverGlobalNodeModulesRoot.mockReset();
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue("/mock/global/node_modules");
  });

  it("sets agentDir from argument", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.agentDir).toBe("/test/agent");
  });

  it("derives sessionsDir under the Ayu agent dir", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.sessionsDir).toBe("/test/agent/ayu/sessions");
  });

  it("derives subagentSessionsDir under the Ayu agent dir", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.subagentSessionsDir).toBe("/test/agent/ayu/subagent-sessions");
  });

  it("derives forwardingDir as Ayu sessionsDir/permission-forwarding", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.forwardingDir).toBe(
      posix.join("/test/agent/ayu/sessions", "permission-forwarding"),
    );
  });

  it("derives globalLogsDir via getGlobalLogsDir(agentDir)", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.globalLogsDir).toBe(getGlobalLogsDir("/test/agent"));
  });

  it("includes agentDir in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent");
  });

  it("includes Ayu agentDir and Ayu agentDir/git in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/ayu");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/ayu/git");
  });

  it("includes discovered global node_modules root in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/mock/global/node_modules");
  });

  it("omits global node_modules from piInfrastructureDirs when discovery returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths("/test/agent");
    expect(paths.piInfrastructureDirs).toHaveLength(3);
    expect(paths.piInfrastructureDirs).toContain("/test/agent");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/ayu");
    expect(paths.piInfrastructureDirs).toContain("/test/agent/ayu/git");
  });

  it("all entries in piInfrastructureDirs are strings (no null)", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths("/test/agent");
    for (const dir of paths.piInfrastructureDirs) {
      expect(typeof dir).toBe("string");
    }
  });

  it("two calls with different agentDirs produce independent results", () => {
    const a = computeExtensionPaths("/agent/a");
    const b = computeExtensionPaths("/agent/b");
    expect(a.agentDir).toBe("/agent/a");
    expect(b.agentDir).toBe("/agent/b");
    expect(a.sessionsDir).toBe("/agent/a/ayu/sessions");
    expect(b.sessionsDir).toBe("/agent/b/ayu/sessions");
  });
});

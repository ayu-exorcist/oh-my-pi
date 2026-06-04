import { getAyuAgentDir, getGlobalLogsDir, joinPathLike } from "./config-paths";
import { discoverGlobalNodeModulesRoot } from "./node-modules-discovery";

/**
 * Immutable path constants derived from `agentDir` at construction time.
 *
 * Computed once at startup in `computeExtensionPaths()` and embedded into
 * `ExtensionRuntime`. Later refactorings (#129 PermissionSession, #130
 * handler classes) consume this as a single dep instead of individual fields.
 */
export interface ExtensionPaths {
  readonly agentDir: string;
  readonly sessionsDir: string;
  readonly subagentSessionsDir: string;
  readonly forwardingDir: string;
  readonly globalLogsDir: string;
  /**
   * Static Pi infrastructure directories used for external-directory
   * read auto-allow. Computed once from `agentDir` and
   * `discoverGlobalNodeModulesRoot()`. Config-based extras
   * (`piInfrastructureReadPaths`) are read from `runtime.config` at
   * call time in the handler so they pick up config reloads.
   */
  readonly piInfrastructureDirs: readonly string[];
}

/**
 * Compute all immutable path constants from `agentDir`.
 *
 * Calls `discoverGlobalNodeModulesRoot()` internally so the result is
 * self-contained. Call this once at extension startup, not at module scope.
 */
export function computeExtensionPaths(agentDir: string): ExtensionPaths {
  const ayuAgentDir = getAyuAgentDir(agentDir);
  const sessionsDir = joinPathLike(ayuAgentDir, "sessions");
  const subagentSessionsDir = joinPathLike(ayuAgentDir, "subagent-sessions");
  const forwardingDir = joinPathLike(sessionsDir, "permission-forwarding");
  const globalLogsDir = getGlobalLogsDir(agentDir);

  const globalNodeModulesRoot = discoverGlobalNodeModulesRoot();
  const piInfrastructureDirs = [
    ...new Set([
      agentDir,
      ayuAgentDir,
      joinPathLike(ayuAgentDir, "git"),
      ...(globalNodeModulesRoot ? [globalNodeModulesRoot] : []),
    ]),
  ];

  return {
    agentDir,
    sessionsDir,
    subagentSessionsDir,
    forwardingDir,
    globalLogsDir,
    piInfrastructureDirs,
  };
}

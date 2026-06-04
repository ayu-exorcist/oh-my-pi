import { basename, join, posix } from "node:path";

const EXTENSION_ID = "pi-permission-system";
const AYU_AGENT_DIRNAME = "ayu";

export const DEBUG_LOG_FILENAME = `${EXTENSION_ID}-debug.jsonl`;
export const REVIEW_LOG_FILENAME = `${EXTENSION_ID}-permission-review.jsonl`;

export function joinPathLike(basePath: string, ...segments: string[]): string {
  const usesPosixStyle = basePath.startsWith("/") && !/^[A-Za-z]:/.test(basePath);
  return usesPosixStyle ? posix.join(basePath, ...segments) : join(basePath, ...segments);
}

export function getAyuAgentDir(agentDir: string): string {
  return basename(agentDir) === AYU_AGENT_DIRNAME
    ? agentDir
    : joinPathLike(agentDir, AYU_AGENT_DIRNAME);
}

export function getGlobalConfigDir(agentDir: string): string {
  return joinPathLike(getAyuAgentDir(agentDir), "extensions", EXTENSION_ID);
}

export function getGlobalConfigPath(agentDir: string): string {
  return joinPathLike(getGlobalConfigDir(agentDir), "config.json");
}

export function getGlobalLogsDir(agentDir: string): string {
  return joinPathLike(getGlobalConfigDir(agentDir), "logs");
}

export function getProjectConfigPath(cwd: string): string {
  return joinPathLike(cwd, ".pi", AYU_AGENT_DIRNAME, "extensions", EXTENSION_ID, "config.json");
}

export function getProjectAgentsDir(cwd: string): string {
  return joinPathLike(cwd, ".pi", AYU_AGENT_DIRNAME, "agents");
}

export function getLegacyGlobalConfigPath(agentDir: string): string {
  return joinPathLike(agentDir, "extensions", EXTENSION_ID, "config.json");
}

export function getLegacyGlobalPolicyPath(agentDir: string): string {
  return joinPathLike(agentDir, "pi-permissions.jsonc");
}

export function getLegacyProjectConfigPath(cwd: string): string {
  return joinPathLike(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
}

export function getLegacyProjectPolicyPath(cwd: string): string {
  return joinPathLike(cwd, ".pi", "agent", "pi-permissions.jsonc");
}

export function getLegacyProjectAgentsDir(cwd: string): string {
  return joinPathLike(cwd, ".pi", "agent", "agents");
}

export function getLegacyExtensionConfigPath(extensionRoot: string): string {
  return joinPathLike(extensionRoot, "config.json");
}

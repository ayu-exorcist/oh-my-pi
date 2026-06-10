import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export const workspaceSourceAliases = [
  {
    find: /^@ayulab\/pi-checkpoint\/testing$/,
    replacement: `${repoRoot}/sdk/pi-checkpoint/src/testing/index.ts`,
  },
  {
    find: /^@ayulab\/pi-checkpoint$/,
    replacement: `${repoRoot}/sdk/pi-checkpoint/src/index.ts`,
  },
  {
    find: /^@ayulab\/runtime-core$/,
    replacement: `${repoRoot}/internal/runtime-core/src/index.ts`,
  },
] as const;

export function createWorkspaceVitestConfig(config: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      resolve: {
        alias: workspaceSourceAliases,
      },
    }),
    defineConfig(config),
  );
}

export function strictCoverageConfig(): ViteUserConfig["test"] {
  return {
    coverage: {
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  };
}

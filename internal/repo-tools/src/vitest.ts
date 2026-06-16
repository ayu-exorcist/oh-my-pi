import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

type CoverageConfig = NonNullable<NonNullable<ViteUserConfig["test"]>["coverage"]>;

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

export interface StrictCoverageOptions {
  readonly include?: CoverageConfig["include"];
  readonly reporter?: CoverageConfig["reporter"];
}

export function strictCoverageConfig(options: StrictCoverageOptions = {}): ViteUserConfig["test"] {
  return {
    coverage: {
      provider: "v8",
      reporter: options.reporter ?? ["text"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      ...(options.include ? { include: options.include } : {}),
    },
  };
}

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

export function createRootVitestConfig(config: ViteUserConfig = {}): ViteUserConfig {
  return mergeConfig(
    defineConfig({
      test: {
        alias: workspaceSourceAliases,
        projects: ["extensions/*", "sdk/*", "internal/*", "scripts"],
        silent: true,
        testTimeout: 15000,
      },
    }),
    defineConfig(config),
  );
}

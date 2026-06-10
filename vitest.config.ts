import { strictCoverageConfig, workspaceSourceAliases } from "@ayulab/repo-tools/vitest";
import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration for the monorepo.
 *
 * - Uses workspace-aware `projects` so that tests in `extensions/*`, `sdk/*`,
 *   `internal/*`, and `scripts` pick up their local `vitest.config.ts` files.
 * - Path aliases for workspace packages are defined here once; sub-packages
 *   do not repeat them.
 * - Coverage provider is v8; thresholds match current project baseline.
 */
export default defineConfig({
  test: {
    alias: workspaceSourceAliases,
    projects: ["extensions/*", "sdk/*", "internal/*", "scripts"],
    testTimeout: 15000,
    ...strictCoverageConfig(),
    coverage: {
      ...strictCoverageConfig()?.coverage,
      reporter: ["text", "html"],
    },
  },
});

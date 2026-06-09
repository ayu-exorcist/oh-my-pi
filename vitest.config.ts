import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration for the monorepo.
 *
 * - Uses workspace-aware `projects` so that tests in `extensions/*`, `sdk/*`,
 *   and `scripts` pick up their local `vitest.config.ts` files.
 * - Path aliases for workspace packages are defined here once; sub-packages
 *   do not repeat them.
 * - Coverage provider is v8; thresholds match current project baseline.
 */
export default defineConfig({
  test: {
    alias: {
      "@ayulab/pi-checkpoint": "sdk/pi-checkpoint/src/index.ts",
      "@ayulab/pi-checkpoint/testing": "sdk/pi-checkpoint/src/testing/index.ts",
    },
    projects: ["extensions/*", "sdk/*", "scripts"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});

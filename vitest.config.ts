import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration for the monorepo.
 *
 * - Uses workspace-aware `projects` so that tests in `extensions/*`, `sdk/*`,
 *   and `scripts` pick up their local `vitest.config.ts` files.
 * - Enforces high coverage across statements, branches, functions, and lines.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@ayulab/pi-checkpoint": "sdk/pi-checkpoint/src/index.ts",
      "@ayulab/pi-checkpoint/testing": "sdk/pi-checkpoint/src/testing/index.ts",
    },
  },
  test: {
    projects: ["extensions/*", "sdk/*", "scripts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html"],
      thresholds: {
        statements: 99,
        branches: 97,
        functions: 99,
        lines: 100,
      },
    },
  },
});

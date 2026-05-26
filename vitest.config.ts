import { defineConfig } from "vitest/config";

/**
 * Root Vitest configuration for the monorepo.
 *
 * - Uses workspace-aware `projects` so that tests in `extensions/*` and `sdk/*`
 *   pick up their local `vitest.config.ts` files (coverage settings, etc.).
 * - Enforces 100 % coverage across statements, branches, functions, and lines.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@ayulab/pi-checkpoint": "sdk/pi-checkpoint/src/index.ts",
      "@ayulab/pi-checkpoint/testing": "sdk/pi-checkpoint/src/testing/index.ts",
    },
  },
  test: {
    projects: ["extensions/*", "sdk/*"],
    coverage: {
      provider: "istanbul",
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
